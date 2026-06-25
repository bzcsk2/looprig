# Agent Run-Level Scoring System

状态：第一版核心能力已落地。

目标：让 DeepReef 能在 benchmark 和真实 workflow 两个场景中评估 Worker 的 agent 能力，并把 Supervisor 的评分反馈用于下一轮 Worker 策略调整。

## 背景

DeepReef 已有 Worker/Supervisor 双 Agent workflow、结构化 Supervisor decision、Goal runtime、Mailbox、benchmark matrix 和 per-role model target。新增 scoring system 不是替代这些能力，而是给每一轮 Worker 行为增加可持久化、可比较、可反馈的评价层。

这套系统解决三个问题：

- 不同 Worker 模型在同一任务类型下的能力差异需要可比较。
- 真实任务中 Supervisor 的 review 需要变成结构化评分，而不是只留下自然语言反馈。
- 评分结果需要影响下一轮 Worker 的执行策略，例如要求拆解任务、补验证、收紧工具使用、提高报告质量。

## 参考项目

Benchmark 设计参考了 GitHub 和学术常见 coding-agent / code-generation 评测，以及 he-yufeng 的公开 agent 测评类项目：

- SWE-bench / SWE-bench Verified：真实 GitHub issue 修复，强调 repo 理解、补丁正确性和测试验证。
- HumanEval：函数级代码生成，强调小任务 correctness。
- MBPP：基础编程任务，强调示例驱动和单元测试。
- RepoBench：仓库导航和长上下文理解。
- CodeJoust：同一任务并行跑不同 agent，用测试通过率、成本、diff 大小、耗时排序。
- LiteBench：benchmark runner + agent mode，记录 multi-turn tool trace。
- AgentProbe：snapshot baseline、语义回归、mock LLM、工具调用断言。
- IssueBenchKit：把真实 GitHub/local issue 打包成 before/after 可复现任务。

参考链接：

- https://github.com/he-yufeng/CodeJoust
- https://github.com/he-yufeng/LiteBench
- https://github.com/he-yufeng/AgentProbe
- https://github.com/he-yufeng/IssueBenchKit
- https://github.com/he-yufeng

## 已实现代码

核心模块：

- `packages/core/src/scoring/types.ts`
- `packages/core/src/scoring/rubric.ts`
- `packages/core/src/scoring/evaluator.ts`
- `packages/core/src/scoring/store.ts`
- `packages/core/src/scoring/benchmark-catalog.ts`
- `packages/core/src/scoring/benchmark-runner.ts`
- `packages/core/src/scoring/index.ts`

Workflow 集成：

- `packages/core/src/workflow-coordinator/types.ts`
- `packages/core/src/workflow-coordinator/structured-protocol.ts`
- `packages/core/src/workflow-coordinator/coordinator.ts`
- `packages/core/src/dual-agent-runtime/dual-runtime.ts`
- `packages/cli/src/tui.ts`

测试：

- `packages/core/__tests__/agent-run-scoring.test.ts`
- `packages/core/__tests__/workflow-coordinator.test.ts`
- `packages/core/__tests__/structured-protocol.test.ts`

脚本：

- `packages/core/scripts/agent-scoring-benchmark.ts`

## 评分维度

默认 rubric：`DEFAULT_AGENT_SCORE_RUBRIC`。

每轮评分包含 9 个维度：

- `taskCompletion`：任务完成度。
- `verification`：测试、typecheck、lint、手工验证等证据。
- `toolUse`：工具调用是否有效，是否有重复失败。
- `efficiency`：轮次、耗时、调用密度上的效率。
- `autonomy`：是否能自己推进，还是频繁卡住。
- `instructionFollowing`：是否遵循 Supervisor plan 和用户约束。
- `recovery`：遇到失败后的恢复能力。
- `communication`：报告是否足够清晰、可审查。
- `safety`：是否有绕过权限、忽略安全约束等风险。

输出等级：

- `S / A / B / C / D / F`
- `overallScore` 为 0-100。
- 每个维度都有 score、weight、rationale。

## Supervisor 结构化评分

Supervisor decision schema 现在支持可选字段 `workerAssessment`：

```json
{
  "workerAssessment": {
    "summary": "Worker skipped verification.",
    "completed": false,
    "verificationPassed": false,
    "dimensions": {
      "taskCompletion": 45,
      "verification": 20,
      "communication": 50
    },
    "promptStrategies": [
      {
        "kind": "require_verification",
        "rationale": "Tests were not run."
      }
    ]
  }
}
```

如果 Supervisor 给出维度分数，scoring evaluator 优先使用 Supervisor 的评分。如果没有给，evaluator 会根据 Worker report、结构化 plan/report、验证结果、blocker、tool calls 等信息做启发式评分。

## 真实任务中的反馈闭环

每次 `supervisor_check` 后：

1. `WorkflowCoordinator.recordRunScore()` 解析当前 plan、Worker report 和 Supervisor assessment。
2. 调用 `evaluateAgentRunScore()` 生成 `AgentRunScore`。
3. 把结果写入 `state.lastRunScore`。
4. 通过 `run_score` workflow event 发给上层 UI / logger。
5. 如果 CLI/TUI 创建了 `AgentScoreStore`，写入 `.deepreef/scores/<workflowId>.jsonl`。
6. `runtime_adjustment` event 记录已应用到 Worker runtime 的非持久化调整。
7. 下一轮 `worker_do` 会把 `lastRunScore.adjustment` 注入 Worker prompt。

下一轮 Worker 会收到类似信息：

```text
Worker strategy adjustment from the previous run score:
- Overall score: 56 (D)
- Recommended harness strictness: strict
- Recommended thinking mode: high
- Weakest dimensions to address: verification=20, taskCompletion=45
- Prompt strategies:
- require_verification: Tests were not run.

Apply these as execution strategy for this iteration. Keep the original goal and Supervisor plan authoritative.
```

当前会把评分建议以非持久化方式应用到 Worker runtime：

- `recommendedThinking` → `workerEngine.setThinkingMode()`
- `recommendedMaxTokens` → `workerEngine.updateConfig({ maxTokens })`
- `recommendedHarness` → `workerEngine.setHarnessStrictness()`

它不会自动改写用户配置文件。原因是配置系统还在规划中，自动持久化模型/权限/工具策略应由统一 config manager 控制。

## Benchmark Catalog

默认 suite：`DEFAULT_AGENT_BENCHMARK_SUITE`，id 为 `deepreef-agent-scoring-v1`。

当前 case 来源：

- `swe-bench`
- `human-eval`
- `mbpp`
- `repo-bench`
- `codejoust`
- `litebench`
- `agentprobe`
- `issuebenchkit`
- `deepreef-regression`

每个 case 声明：

- `source`
- `difficulty`
- `taskType`
- `prompt`
- `verification`
- `evaluationSignals`
- `tags`

`evaluationSignals` 支持：

- `test-pass-rate`
- `before-after-verdict`
- `tool-trace`
- `snapshot-regression`
- `semantic-regression`
- `schema-validity`
- `cost`
- `diff-size`
- `wall-time`
- `supervisor-judge`

`selectBenchmarkCases()` 支持按 tag、source 或 evaluation signal 筛选。

## Benchmark Runner API

第一版 runner 是纯 core API，不直接调用模型。它负责把外部 benchmark 执行结果转换成标准分数，并生成 suite summary / model leaderboard。

接口：

```ts
const run = scoreBenchmarkRun({
  case: AGENT_BENCHMARK_CASES[0],
  workerModelTarget: "worker:gpt-5",
  completed: true,
  verificationPassed: true,
  workerReport: "Implemented and verified.",
  verificationCommands: ["bun test"],
  toolCalls: 5,
  toolFailures: 0,
  durationMs: 10000,
  costUsd: 0.02,
  diffLinesChanged: 32,
})

const summary = summarizeBenchmarkSuite("deepreef-agent-scoring-v1", [run])
const leaderboard = buildBenchmarkLeaderboard(summary.runs)
```

自动遍历模型 × 用例：

```ts
const result = await runAgentBenchmarkSuite({
  suite: DEFAULT_AGENT_BENCHMARK_SUITE,
  workerModelTargets: ["local-8b", "remote-medium"],
  supervisorModelTarget: "supervisor:judge",
  executeCase: async ({ case: benchmarkCase, workerModelTarget }) => {
    // 这里接真实 Worker 执行器、验证命令和 Supervisor judge。
    return {
      case: benchmarkCase,
      workerModelTarget,
      completed: true,
      verificationPassed: true,
      workerReport: "Implemented and verified.",
    }
  },
})
```

这允许后续真实执行器分阶段接入：

- CLI/CI 负责实际 checkout、运行 Worker、执行验证命令。
- scoring runner 负责统一打分和聚合。
- TUI / report 负责展示结果。

当前提供一个 smoke runner：

```bash
bun run packages/core/scripts/agent-scoring-benchmark.ts
bun run packages/core/scripts/agent-scoring-benchmark.ts --tag tool-trace
bun run packages/core/scripts/agent-scoring-benchmark.ts --models local-8b,remote-medium
```

这个脚本使用 deterministic mock outcome，不调用真实模型，适合作为 scoring pipeline 的本地/CI 冒烟验证。

## 数据落盘

默认路径：

```text
.deepreef/scores/<workflowId>.jsonl
```

接口：

```ts
const store = new AgentScoreStore()
store.append(score)
store.list(workflowId)
store.latest(workflowId)
```

JSONL 结构使用 `AgentRunScore`，便于后续做：

- TUI score timeline。
- Worker model leaderboard。
- per-task regression report。
- CI 或 nightly benchmark 汇总。

## 与配置系统的关系

这次实现先把 scoring 核心和 workflow 闭环接上。后续应按 `docs/TODO-2026-06-24-配置系统.md` 的统一控制面继续扩展，不建议散落增加临时配置项。

建议配置 schema 预留：

```toml
[scoring]
enabled = true
persist = true
store_path = ".deepreef/scores"
default_suite = "deepreef-agent-scoring-v1"
auto_prompt_adjustment = true
auto_runtime_adjustment = false

[scoring.thresholds]
strict_below = 58
thinking_high_below = 65
preserve_above = 82
```

当前 `auto_runtime_adjustment` 应拆成两层：

- `runtime_session_adjustment = true`：允许当前会话内应用 thinking、maxTokens、harness strictness。当前代码已按这个策略工作。
- `runtime_persistent_adjustment = false`：禁止自动写入项目或用户配置文件。

持久化调整应保持默认 false。原因：

- 自动切换 harness/model/token budget 可能影响用户成本和权限预期。
- 统一配置系统还未提供变更审计、临时覆盖和持久化策略。
- prompt adjustment 已能提供低风险的闭环反馈。

## 后续 TODO

- 在 TUI 中展示当前 workflow 的 latest score、grade、弱项维度和建议策略。
- 增加 score history view，按 workflow 展示每轮分数曲线。
- 增加真实 benchmark executor，把 `AgentBenchmarkCase` 转成实际可执行任务包并调用 Worker。
- 增加 Worker model leaderboard，按 model target、case source、evaluation signal 聚合。
- 在统一配置系统完成后，把 `[scoring]` schema 接入 config loader。
- 支持用户选择是否允许 scoring 自动调整 harness strictness、thinking mode、max output tokens。
- 增加 cost、duration、diff stats 的真实采集，目前类型和 evaluation signal 已预留。
- 增加 IssueBenchKit 风格的本地 issue task manifest，支持 before/after validation command。
- 增加 AgentProbe 风格 snapshot baseline，覆盖 prompt/model 变更后的 agent behavior regression。
- 增加 HTML/Markdown scoring report，方便提交 PR 或长期比较。

## 验证记录

已执行：

```bash
bun test packages/core/__tests__/agent-run-scoring.test.ts packages/core/__tests__/workflow-coordinator.test.ts packages/core/__tests__/structured-protocol.test.ts
bun test packages/core
bun run packages/core/scripts/agent-scoring-benchmark.ts --tag tool-trace --models local-8b,remote-medium
bun run typecheck
```

结果：

- targeted tests：67 pass。
- core tests：1221 pass。
- agent scoring benchmark smoke：通过。
- typecheck：通过。
