# Deepicode TODO 与开发交接指南

最后更新：2026-06-04

本文是后续 Agent 的唯一待办入口，只记录**尚未完成**、**待验收**、**明确暂缓**或**已经驳回**的工作。
已完成能力和历史实施结论见 [DONE.md](DONE.md)。Context 的专项设计见 [ADVICE.md](ADVICE.md)。CI 与平台兼容性执行规范见 [CI-Compatibility-Fix-Guide.md](CI-Compatibility-Fix-Guide.md)。

---

## 0. 开发规则

### 0.1 每次只领取一个闭环

1. 从本文领取一个任务编号。
2. 阅读任务列出的文件和邻近测试，不要先做跨模块重构。
3. 先写失败测试，再做最小实现。
4. 运行目标测试、`bun run typecheck`、`bun test`、`git diff --check`。
5. 完成后从本文删除任务，在 `DONE.md` 记录实现边界、验证命令和保留限制。

工作区可能已有其他 Agent 或用户的改动。禁止用 `git reset --hard`、`git checkout --` 等命令清理不属于当前任务的修改。

### 0.2 不可破坏的架构边界

| 边界 | 当前正确做法 | 禁止事项 |
|------|--------------|----------|
| Core 与 TUI 解耦 | `engine.submit()` 只产出 `AsyncGenerator<LoopEvent>` | 不要从 Core import React、Ink 或 TUI 组件 |
| TUI 状态模型 | `TimelineItem[] + TurnView`，由 `bridge.tsx` 消费事件 | 不要引入完整 `Card[] / Store / TurnTranslator` |
| 工具索引 | 流式事件使用 `toolCallIndex` 关联 | 不要用工具名作为唯一 key |
| 工具结果 | `ToolResult.content` 始终是字符串 | 不要把对象直接塞入上下文，不要绕过 `isError` |
| 权限 | `deny → allow → ask`；`exec` 默认需要确认 | 不要给后台子 Agent 静默放开 `exec` |
| 嵌套工具 | 通过 `ToolContext.invokeTool()`，递归调用被拒绝 | 不要创建第二套 ToolRegistry 或直接调用 Shell |
| MCP | 外部工具通过 MCP bridge 按需发现和调用 | 不要把动态 MCP schema 混入静态 prefix |
| 上下文前缀 | `ImmutablePrefix` 由 system prompt + tool specs 指纹控制 | 不要无理由改变 system prompt 或 schema 顺序 |
| Session | `.deepicode/sessions/*.jsonl`，best-effort append | 不要让持久化失败阻塞主流程 |
| 生命周期 | CLI、Engine、Context、MCP 和 logger 必须显式释放 | 不要用 `process.exit(0)` 掩盖 worker、子进程或日志 flush 泄漏 |
| 编辑 | 保留 stale-read、敏感路径和原子写边界 | 不要用直接覆盖替换安全写入路径 |
| 浏览器 | Playwright 子进程隔离，入口和页面请求执行 SSRF 检查 | 不要允许 localhost、私网 IP、`.local`、`.internal` |

### 0.3 验证命令

```bash
bun run typecheck
bun test
git diff --check
```

目标测试：

```bash
bun test packages/tui/__tests__/bridge.test.ts
bun test packages/core/__tests__/session.test.ts
bun test packages/core/__tests__/streaming-executor.test.ts packages/core/__tests__/engine-tools.test.ts
bun test packages/tools/__tests__/edit.test.ts packages/tools/__tests__/edit-integration.test.ts
bun test packages/mcp/__tests__/mcp-host.test.ts packages/mcp/__tests__/mcp-tools.test.ts
```

---

## 1. 推荐领取顺序

| 顺序 | 任务 | 原因 |
|------|------|------|
| 1 | `IC-10` BranchBudget 轻量分支预算 | iceCoder 中最值得借鉴的长任务防循环机制，侵入小、收益高。 |
| 2 | `IC-20` Runtime checkpoint v2 | 为 Deepicode 增加任务运行态快照，支撑压缩、恢复和长任务诊断。 |
| 3 | `IC-30` Shell 双轨执行增强 | 借鉴 iceCoder 的长/短命令自动分流，减少测试/build 阻塞 TUI。 |
| 4 | `IC-40` 工具参数 normalize/salvage | 小改动高收益，降低模型输出畸形参数导致的工具失败。 |
| 5 | `IC-50` Runtime telemetry schema | 在现有 RuntimeLogger 上增加可统计事件，不重做日志系统。 |
| 6 | `FG-60-R` best-effort 日志收尾 | Find_ground 已完成高风险项，剩余低风险日志和状态接入。 |
| 7 | `CTX-70` 文档和验收 | CTX-10/30/40/50 已完成，只剩交付验收。 |
| 8 | `OS-12/13-R` macOS/Windows 原生体验验收 | 三平台 CI 自动化已通过，仍需真实终端体验确认。 |

不要一次领取多个任务。每个编号完成后都应保持全量测试为绿色。

---

## 2. 后续任务

### IC-10：借鉴 iceCoder 的 BranchBudget 轻量分支预算

优先级：`P0`。

来源参考：

- `/vol4/Agent/iceCoder/src/harness/branch-budget.ts`
- `/vol4/Agent/iceCoder/test/harness/branch-budget.test.ts`
- `/vol4/Agent/iceCoder/test/harness/branch-budget-block.test.ts`

目标：

- 防止长任务中模型在同一策略上无限循环。
- 首版只做本地、轻量、可观测的预算拦截，不引入 iceCoder 完整 Supervisor。

需要覆盖的三类预算：

| 维度 | 默认上限 | 触发行为 |
|------|----------|----------|
| 同一文件编辑 | `3` 次 | 第 4 次写入前拦截，返回 tool error，提示换策略。 |
| 同一失败命令 | `2` 次 | 第 3 次失败重试前拦截或返回 warning，提示换命令/读错误原因。 |
| 同一错误签名 | `3` 次 | 生成 recovery hint，提示停止重复尝试。 |

建议新增文件：

- `packages/core/src/branch-budget.ts`
- `packages/core/__tests__/branch-budget.test.ts`

建议接入点：

- `packages/core/src/streaming-executor.ts`
- `packages/core/src/executor-helpers.ts`
- 写入类工具名：`write_file`、`edit`、`hash_edit`、`notebook_edit`、`patch` 类工具按当前 registry 实际名称确认。
- shell 类工具名：当前兼容名仍可能叫 `bash`，不要为了本任务改名。

实施步骤：

1. 实现纯内存 `BranchBudgetTracker`：
   - `recordFileEdit(path)`
   - `recordFailedCommand(command)`
   - `recordError(signature)`
   - `wouldBlockFileEdit(path)`
   - `wouldBlockFailedCommand(command)`
   - `snapshot()` / `restore(snapshot)`
   - `resetForNewUserTurn()`，每次新用户消息可清零短期计数。

2. 规范化 key：
   - 路径用当前 workspace root 归一化，兼容 Windows 反斜杠和大小写。
   - 命令 trim 后压缩空白，截断到 200 字符。
   - 错误签名去除时间戳、行列号、绝对临时路径。

3. 在工具执行前做最小拦截：
   - 对写入类工具，若 `wouldBlockFileEdit(path)` 为 true，真实工具不执行，返回 `isError: true`。
   - 对 shell 命令，首版只对“已失败的同一命令重试”拦截，不拦截成功命令重复运行。
   - 拦截消息必须是可读的，例如：`Branch budget exceeded for file <path>; inspect failure and choose a different strategy.`

4. 在工具执行后更新计数：
   - 写入类工具成功后 `recordFileEdit(path)`。
   - shell 工具失败后 `recordFailedCommand(command)`。
   - 任何 tool error 可按 `toolName + normalized error` 记录 error signature。

5. 可观测性：
   - 通过 `RuntimeLogger` 记录 `branch_budget.block`、`branch_budget.recovery_hint`。
   - 不记录文件正文、命令输出全文或敏感参数。

禁止事项：

- 不要把 iceCoder 的 L1/L2 Supervisor 一起搬进来。
- 不要在首版自动修改 prompt 大段规则。
- 不要把成功的测试命令重复运行视为错误。
- 不要阻断用户新一轮明确要求“继续尝试”的操作；新用户 turn 应清理短期预算。

验收测试：

```bash
bun test packages/core/__tests__/branch-budget.test.ts
bun test packages/core/__tests__/streaming-executor.test.ts packages/core/__tests__/engine-tools.test.ts
bun run typecheck
```

关闭条件：

- 同一文件第 4 次写入被拦截，且原文件不变。
- 同一失败命令超过预算后不再执行真实 shell。
- 新用户消息后预算可重新开始。
- runtime log 有结构化事件，但默认关闭时不影响速度。

### IC-20：Runtime checkpoint v2 任务运行态快照

优先级：`P0/P1`。

来源参考：

- `/vol4/Agent/iceCoder/src/harness/checkpoint-engine.ts`
- `/vol4/Agent/iceCoder/src/types/runtime-checkpoint.ts`
- `/vol4/Agent/iceCoder/test/harness/checkpoint-engine.test.ts`

目标：

- 在 Deepicode 现有 `.deepicode/sessions/*.jsonl` 之外，增加 additive checkpoint。
- 保存“任务运行态”，用于长任务恢复、压缩后注入、Bug 诊断。
- 不替换 Session JSONL，不影响现有 recover。

建议新增文件：

- `packages/core/src/runtime-checkpoint.ts`
- `packages/core/src/checkpoint-engine.ts`
- `packages/core/__tests__/checkpoint-engine.test.ts`

建议文件路径：

```text
.deepicode/sessions/<sessionId>.checkpoint.json
```

首版 schema：

```ts
interface RuntimeCheckpointV2 {
  version: 1
  sessionId: string
  updatedAt: string
  recentTools: Array<{
    ts: string
    round?: number
    toolName: string
    success: boolean
    durationMs?: number
    outputLength?: number
  }>
  recentFailures: Array<{
    ts: string
    toolName?: string
    signature: string
    message: string
  }>
  branchBudget?: BranchBudgetSnapshot
  context?: {
    strategy?: "trim" | "compact"
    triggerRatio?: number
    targetRatio?: number
    lastReductionAt?: string
    beforeTokens?: number
    afterTokens?: number
  }
  verification?: {
    pending?: boolean
    lastCommand?: string
    lastExitCode?: number
  }
}
```

实施步骤：

1. `CheckpointEngine` 支持：
   - `load()`
   - `save(input)`
   - `appendTool(entry)`
   - `appendFailure(entry)`
   - `setBranchBudget(snapshot)`
   - recent 数组截断：tools 最多 20，failures 最多 10。

2. 写盘策略：
   - best-effort，不阻塞主流程。
   - 使用临时文件 + rename，避免半写 JSON。
   - 保存失败记录 runtime log：`checkpoint.write_error`。

3. 接入点：
   - `ReasonixEngine` 创建时初始化 checkpoint。
   - `StreamingToolExecutor` 工具完成后 append tool/failure。
   - Context trim/compact 成功后记录 context reduction。
   - `engine.shutdown()` 前 flush pending checkpoint。

4. 恢复策略：
   - 首版只读入并用于 status/debug，不自动改变模型上下文。
   - 后续再考虑把 checkpoint recovery context 注入 compact 后上下文。

禁止事项：

- 不要覆盖 `.deepicode/sessions/*.jsonl`。
- 不要把 checkpoint 写失败变成用户请求失败。
- 不要把完整 tool output、文件正文或 API key 写入 checkpoint。
- 不要一次引入 TaskGraph。

验收命令：

```bash
bun test packages/core/__tests__/checkpoint-engine.test.ts
bun test packages/core/__tests__/session.test.ts
bun test packages/core/__tests__/engine-tools.test.ts
bun run typecheck
```

关闭条件：

- 工具成功/失败后 checkpoint 文件包含 recentTools/recentFailures。
- JSON 写入原子化，损坏旧文件不会阻塞会话。
- checkpoint 写失败只进入 debug/error log，不影响工具结果。

### IC-30：Shell 双轨执行增强

优先级：`P1`。

来源参考：

- `/vol4/Agent/iceCoder/src/tools/builtin/shell-tool.ts`
- `/vol4/Agent/iceCoder/src/tools/shell-runtime-classifier.ts`
- `/vol4/Agent/iceCoder/src/tools/background-task-manager.ts`
- `/vol4/Agent/iceCoder/test/tools/background-incremental-output.test.ts`
- `/vol4/Agent/iceCoder/test/tools/shell-soft-timeout-escalate.test.ts`

目标：

- Deepicode shell 类工具自动区分短命令和长命令。
- 长命令进入后台任务，TUI 不被阻塞。
- 短命令保持前台，输出有上限。
- 支持后台任务 `check/list/stop` 和增量输出 cursor。

当前 Deepicode 相关文件：

- `packages/tools/src/shell-exec.ts`
- `packages/tools/src/task-manager.ts`
- `packages/tools/src/task-create.ts`
- `packages/tools/src/task-get.ts`
- `packages/tools/src/task-list.ts`
- `packages/tools/src/task-stop.ts`
- `packages/tools/src/platform/process-tree.ts`
- `packages/tools/__tests__/bash.test.ts`
- `packages/tools/__tests__/task-manager.test.ts`

实施步骤：

1. 新增 shell 分类器：
   - `packages/tools/src/shell-runtime-classifier.ts`
   - `classifyShellCommand(command): "short" | "long" | "auto"`
   - long 包括：`bun test`、`npm test`、`pnpm test`、`vitest`、`tsc -w`、`npm run dev`、`docker build`、`git clone` 等。
   - short 包括：`git status`、`ls`、`pwd`、`cat`、`rg`、`tsc --noEmit` 等。

2. 前台策略：
   - short 默认 10s hard timeout。
   - output cap 沿用 Deepicode 当前边界。
   - `AbortSignal` 必须透传。

3. 后台策略：
   - long 默认后台启动，立即返回 task id。
   - 支持 `action: "check" | "list" | "stop"`。
   - check 返回 `{status, exitCode, cursor, output, hasMore}`。
   - 每个 session/workspace 隔离后台任务。

4. 软超时升级：
   - 对 `auto` 命令，前台执行超过 8s 可升级后台。
   - 升级后返回 task id，不丢弃已捕获输出。

5. 安全边界：
   - destructive 命令不得静默后台。
   - 继续使用现有危险命令拦截、平台 shell backend 和进程树终止。
   - Windows PowerShell / cmd 兼容必须保留。

禁止事项：

- 不要把工具名 `bash` 全仓改成 `shell`。
- 不要绕过现有 `shell-exec.ts` 的平台和安全检查。
- 不要让后台任务跨 session 泄漏。
- 不要把长命令输出无限保存在内存。

验收命令：

```bash
bun test packages/tools/__tests__/bash.test.ts
bun test packages/tools/__tests__/task-manager.test.ts
bun test packages/tools/__tests__/security-e2e.test.ts
bun run typecheck
```

关闭条件：

- `bun test` 类命令默认后台返回 task id。
- `git status` 类命令前台快速返回。
- `check` 支持增量输出 cursor。
- `stop` 能终止进程树。
- 三平台测试不退化。

### IC-40：工具参数 normalize/salvage

优先级：`P1`。

来源参考：

- `/vol4/Agent/iceCoder/src/tools/tool-arguments-normalizer.ts`
- `/vol4/Agent/iceCoder/src/tools/tool-arguments-salvage.ts`
- `/vol4/Agent/iceCoder/test/tools/tool-arguments-normalizer.test.ts`
- `/vol4/Agent/iceCoder/test/tools/tool-arguments-salvage.test.ts`

目标：

- 降低模型输出非标准 tool arguments 导致的失败率。
- 对可安全修复的参数做 normalize；对疑似截断的大写入给出明确 tool error。

当前 Deepicode 相关文件：

- `packages/core/src/executor-helpers.ts`
- `packages/core/src/streaming-executor.ts`
- `packages/core/__tests__/streaming-executor.test.ts`

需要支持：

1. 单字段 JSON 字符串展开：
   - `{ "raw": "{\"path\":\"a.ts\",\"content\":\"...\"}" }`
   - `{ "arguments": "{\"command\":\"bun test\"}" }`
   - `{ "input": "{...}" }`
   - `{ "params": "{...}" }`

2. 常见别名：
   - `filePath` → `path`
   - `cmd` → `command`

3. 截断 JSON salvage：
   - 只提取常见字符串字段：`path`、`filePath`、`content`、`search`、`replace`、`patch`、`command`、`cmd`。
   - 标记 `_salvageTruncated: true`。
   - 对写入/编辑类工具不要继续真实执行，返回指导性错误：拆小、用 patch、不要重试同一整文件写入。

实施步骤：

1. 新增：
   - `packages/core/src/tool-arguments-normalizer.ts`
   - `packages/core/src/tool-arguments-salvage.ts`
   - 对应测试。

2. 在 `parseToolCallArgs()` 中接入：
   - JSON.parse 成功后 normalize。
   - JSON.parse 失败时尝试 salvage。
   - salvage 成功但属于写入类工具，返回 `ok: false` + 可读错误。
   - salvage 成功且是只读/命令类参数，可按风险评估允许执行；首版建议只 normalize，不执行截断写入。

3. 加日志：
   - `tool.arguments.normalized`
   - `tool.arguments.salvaged_truncated`
   - 不记录原始 arguments 全文。

禁止事项：

- 不要把非法 JSON 静默当成功。
- 不要执行截断的 `content` 写入。
- 不要把工具参数对象直接写入上下文；仍必须走 `ToolResult.content` 字符串。

验收命令：

```bash
bun test packages/core/__tests__/tool-arguments-normalizer.test.ts
bun test packages/core/__tests__/streaming-executor.test.ts
bun run typecheck
```

关闭条件：

- wrapper 参数能正常展开。
- `cmd` / `filePath` alias 生效。
- 截断写入不会执行真实工具，并返回明确恢复建议。

### IC-50：Runtime telemetry schema，不重做日志系统

优先级：`P1/P2`。

来源参考：

- `/vol4/Agent/iceCoder/src/harness/runtime-telemetry.ts`
- `/vol4/Agent/iceCoder/test/harness/harness-llm-log.test.ts`

目标：

- 在 Deepicode 现有 `RuntimeLogger` 上增加可统计事件 schema。
- 支持后续生成运行质量报告：工具失败率、压缩收益、验证率、上下文用量。
- 不新增第二套 logger。

当前 Deepicode 相关文件：

- `packages/core/src/runtime-logger.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/loop.ts`
- `packages/core/src/streaming-executor.ts`
- `packages/core/src/status.ts`
- `packages/core/__tests__/runtime-logger.test.ts`

建议事件：

| 事件 | 触发点 | 字段 |
|------|--------|------|
| `runtime.round` | 每轮 LLM 请求前/后 | `sessionId`、`round`、`messageCount`、`inputTokens`、`outputTokens` |
| `runtime.tool` | 工具完成后 | `toolName`、`success`、`durationMs`、`outputLength`、`isError` |
| `runtime.context_reduction` | trim/compact 后 | `strategy`、`beforeTokens`、`afterTokens`、`savedTokens` |
| `runtime.summary` | submit done/shutdown | `rounds`、`toolCalls`、`errors`、`stopReason` |
| `runtime.branch_budget_block` | IC-10 拦截 | `dimension`、`keyHash`、`limit` |

实施步骤：

1. 不改 `RuntimeLogger` 基础写入机制，只新增小 helper：
   - `packages/core/src/runtime-telemetry.ts`
   - helper 只包装 logger，不持有额外文件 sink。

2. 所有事件默认受 `DEEPICODE_LOG_LEVEL` 控制。

3. 高频路径保护：
   - 只有 logger enabled 时才计算耗时之外的重字段。
   - key 可 hash，不写敏感参数。

4. `/status` 可选显示最近 summary 统计，但不要阻塞本任务。

禁止事项：

- 不要引入 pino/winston 等新日志依赖。
- 不要写第二份 JSONL。
- 不要记录 prompt、tool output 全文、API key、文件正文。

验收命令：

```bash
bun test packages/core/__tests__/runtime-logger.test.ts
bun test packages/core/__tests__/engine-status.test.ts
bun run typecheck
```

关闭条件：

- debug/info 打开时能看到 round/tool/context/summary 事件。
- `DEEPICODE_LOG_LEVEL=off` 不产生日志。
- 默认关闭时无明显性能影响。

### IC-60：轻量 TaskState 与验证门禁评估

优先级：`P2`，依赖 `IC-10`、`IC-20`。

来源参考：

- `/vol4/Agent/iceCoder/src/harness/task-state.ts`
- `/vol4/Agent/iceCoder/src/harness/verification-digest.ts`
- `/vol4/Agent/iceCoder/test/harness/task-state.test.ts`

目标：

- 只借鉴 iceCoder 的“任务状态账本”和“改过代码后需验证”思想。
- 不引入完整 TaskGraph。

首版建议只做设计评审，不直接编码：

1. 识别 Deepicode 是否已经有同等能力。
2. 定义最小 `TaskStateSnapshot`：
   - intent
   - changedFiles
   - commandsRun
   - verificationPending
   - lastVerification
3. 只在 `/status`、checkpoint、日志中展示，不先强制拦截最终回答。

关闭条件：

- 形成 ADVICE 或 TODO 子任务后再编码。

### IC-70：文件化长期记忆最小版评估

优先级：`P3`。

来源参考：

- `/vol4/Agent/iceCoder/src/memory/file-memory/`
- `/vol4/Agent/iceCoder/docs/requirement/记忆系统调整-finish.md`

目标：

- 评估 Deepicode 是否需要项目事实/用户偏好/会话摘要三类 Markdown 记忆。
- 不搬 iceCoder 全套 Dream、eviction、LLM 精排。

首版建议：

- 只做设计，不编码。
- 如果编码，先实现只读召回，不自动写入长期记忆。
- 明确和现有 `skills`、session summary、compact summary 的边界。

禁止事项：

- 不要把 memory 注入 system prompt 前缀。
- 不要让旧偏好覆盖当前用户明确指令。
- 不要把 API key、密钥、私有正文自动写入 memory。

### FG-60-R：best-effort 日志收尾

优先级：`P2`。

当前状态：

- FG-20 TokenizerPool diagnostics/fallback 修复已完成。
- FG-30 SessionLoader `readDetailed()` 已完成。
- FG-40 工具参数 invalid JSON fail-fast 已完成。
- FG-50 edit fuzzy fallback warning 已完成。
- FG-70 MCP load summary/CLI 提示已完成。

剩余目标：

1. 将 `AsyncSessionWriter.getStatus()` 接入 `/status` 或 engine status snapshot。
2. 为 `hash-edit.ts` 和 `notebook-edit.ts` 的 `chmod(tmpPath)` / `unlink(tmpPath)` 失败补低噪音日志或可测试状态，不覆盖原始错误。
3. 为 runtime logger 清理失败保留 debug 级可观测性，不升级为阻断错误。
4. 可选：为 `edit.fuzzy_fallback` 增加 runtime log，仍不记录文件正文。

验收命令：

```bash
bun run typecheck
bun test packages/core/__tests__/session.test.ts
bun test packages/tools/__tests__/edit.test.ts packages/tools/__tests__/edit-integration.test.ts
```

### CTX-70：文档和验收

优先级：`P1`。

当前状态：

- CTX-10/30/40/50 代码已完成。
- `/context` 菜单已接入真实 engine policy，可切换 `trim/compact`、调整 `70% -> 30%`、显示当前用量并执行 `Run now`。
- 本轮已修复 reset 后 slash menu 相关 TUI 文件恢复不完整导致的类型错误。
- 本轮已实际验证：`bun run typecheck`、`bun test packages/tui` 通过。
- 本轮完整 `bun test` 按用户要求中断，不作为本轮结论。

目标：

- 把这个专项从"代码完成"变成"可以交接给别的 agent / 人工验收"的状态。

执行要求：

1. README 增加 `/context` 说明。
2. TODO 记录当前 CTX 阶段。
3. DONE 记录已完成阶段。
4. 手工验收 `70% -> 30%` 的 trim 和 compact。

手工验收建议：

1. 启动 TUI。
2. 输入 `/context`。
3. 选择 `trim`，设置 `70% -> 30%`，保存。
4. 用长会话把上下文推到 70% 以上，确认自动裁剪到约 30%。
5. 切换 `compact`，重复长会话，确认出现 summary。
6. 模拟 summarizer 失败，确认 fallback trim。
7. 退出并重启，确认配置仍然生效。

验收命令：

```bash
bun test packages/core/__tests__/context-policy.test.ts
bun test packages/core/__tests__/context-summary.test.ts
bun test packages/core/__tests__/engine-context-policy.test.ts
bun test packages/core/__tests__/context-summarizer.test.ts
bun test packages/tui/__tests__/commands.test.ts
bun run typecheck
bun test
```

### OS-12/13-R：macOS 与 Windows 原生体验验收

优先级：`P1`。三平台 CI 自动化已通过；本项只保留真实终端和系统集成体验确认。

当前状态：

- 路径、文件 URL、权限位和 Monitor backend 的代码层已完成。
- 最新 CI 已确认 `ubuntu-latest`、`macos-latest`、`windows-latest` 全部通过。
- CI 修复和后续排查方法已沉淀到 [CI-Compatibility-Fix-Guide.md](CI-Compatibility-Fix-Guide.md)。
- 原生平台仍需人工确认真实 TUI、PTY/ConPTY、通知、剪贴板、中文路径和终端显示体验。

执行要求：

1. macOS 验证 Bash、BSD `ps`、`df`、`osascript`、crontab、PTY、路径边界和 TUI 显示。
2. Windows 验证 PowerShell backend、ConPTY、盘符、反斜杠、UNC path、中文与空格路径、进程树、Monitor、Scheduler、通知 fallback、剪贴板和 TUI 显示。
3. GitHub Actions Matrix 已覆盖自动化部分，但不能替代真实终端体验确认。

关闭条件：

- CI 最新 master run 三平台 success。
- 项目负责人完成目标平台人工验收。
- 结果写入 `DONE.md`。



---

## 3. 当前验证状态

- CTX-10：策略类型、配置加载和菜单解析 ✅ 已完成
- CTX-30：摘要区和 summarizer 接口 ✅ 已完成
- CTX-40：Engine 自动 trim/compact 触发 ✅ 已完成
- CTX-50：真实 LLM summarizer ✅ 已完成
- CTX-70：文档和验收 ⬜ 待开始
- FG-20/30/40/50/70：隐性兜底高风险项 ✅ 已完成
- FG-60-R：best-effort 日志收尾 ⬜ 待开始
- CI/平台自动化：`6379767` 对应 run `26928659701` 三平台 ✅ 已通过

下一步：执行 `FG-60-R` 或 `CTX-70`。

---

## 4. 明确暂缓

除非用户明确要求，不要顺手实现：

- 动态 bash 并发判断。
- bash 特判级联取消。
- 默认 LLM 摘要。
- 引入官方 tokenizer；先用真实 usage 校准当前估算误差。
- TTSR 规则系统。
- Universal Config Discovery。
- Python Kernel。
- Web、IDE Plugin、TUI Plugin 等多前端。
- AskUserQuestion 专用 TUI 选择弹窗。
- WebBrowser 跨调用持久会话。
- 完整 OAuth 型 MCP 身份系统。
- 将兼容工具名 `bash` 全仓重命名为 `shell`。
- 为 macOS 完整实现 `launchd` backend。
- 为包结构新增 shared/contracts 包；只有真实循环依赖出现时再评估。
- README 全面重写、配置指南和发布包。

---
