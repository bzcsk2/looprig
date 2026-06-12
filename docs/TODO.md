# Deepreef 融合升级 TODO 与开发交接指南

最后更新：2026-06-12

本文是后续 Agent 的唯一待办入口。目标是把 Deepreef 升级为：

> **本地小模型负责执行，免费或低成本中模型负责监督和纠偏，运行时治理保证任务可持续、可验证、可恢复。**

已完成能力和历史实施结论见 [DONE.md](DONE.md)。原始方向讨论见 [Deepreef后续开发计划.md](Deepreef后续开发计划.md)。

---

## 0. 总体决策

### 0.1 产品与架构定位

Deepreef 不做另一个 SmallCode，也不整仓合并 iceCoder。

- Deepreef 保留：Core/TUI 解耦、事件流、Context、Session、MCP、skills、plugin、subagent、权限、免费模型 provider 和现有工具系统。
- 从 SmallCode 搬：本地小模型 profile、read-before-write、early-stop、计划锚点、两阶段工具路由、监督/升级的配置和触发思路。
- 从 iceCoder 搬：BranchBudget、CheckpointEngine v2、shell 双轨、工具参数 salvage、文本工具调用 salvage、Verification Gate、free/forced 模式；TaskGraph 和 L1/L2 takeover 后置。
- 中模型 Supervisor 默认只返回**结构化指导**，不直接执行工具、不直接改文件。Worker 收到指导后继续执行。
- 删除 `free-auto` 虚拟 provider。免费 API 和免费模型目录保留，由用户明确选择；系统不得自动在免费模型之间切换。
- 删除自动推理强度调节。用户仍可明确选择 `off/open/high`，运行时不得自动改变 thinking、model、temperature 或策略 tier。
- 免费 Supervisor 接口不可用时必须降级为本地继续、等待冷却或请求用户决定，不能让任务运行态丢失。

目标调用链：

```text
用户任务
  -> TaskClassifier
  -> Worker ModelTarget（默认本地小模型）
  -> ModelProfile + HarnessProfile
  -> Worker 子 agent 执行工具
  -> 确定性验证 / BranchBudget / EarlyStop
  -> 失败达到阈值
  -> SupervisorRouter（用户显式配置的免费优先中模型池）
  -> SupervisorAdvice（诊断、下一步策略、约束、验证建议）
  -> Worker 继续执行
  -> Verification Gate
  -> 完成 / checkpoint 暂停 / 请求用户
```

### 0.2 已确认的关键现状

1. ~~Deepreef 当前有 `free-auto` 虚拟 provider，但项目负责人决定删除。~~ 已于 `RM-10` 删除。Zen、Kilo 等免费 provider/model 保留，用户手动选择。
2. ~~Deepreef 当前有两套自动推理强度机制~~ 已于 `RM-20` 删除；用户仅可显式选择 `off/open/high`。
3. ~~child engine 共享父级 `client`~~ 已于 `DRF-10` 修复；`SubagentRunOptions.target` 可按角色切换 provider/baseUrl/client。
4. ~~必须先实现 ModelTarget~~ 已于 `DRF-10` 完成；Supervisor 指导闭环见 `DRF-50`–`DRF-60`。
5. Deepreef 已有 stale-read 和编辑安全边界。搬 SmallCode read-before-write 时必须复用现有路径规范化与工具执行入口，不能建立第二套写文件实现。
6. Deepreef 已有 Context trim/compact 和 immutable prefix。小模型运行态、计划和 SupervisorAdvice 应注入可变任务状态区，不能频繁修改 immutable system prefix。
7. `stepfun/step-3.7-flash:free` 曾在小输出预算下只返回 reasoning。用户期望的 StepFun 3.5 必须先通过真实 smoke test，再加入 Supervisor 候选池；计划中不得假定模型 ID、免费额度或工具能力稳定。
8. ~~子 Agent `bubble` 未真正冒泡、权限按工具名无限放行~~ 已于 `PERM-10` 修复；`safe/balanced/yolo` 与 pattern-based `once/always/reject` 已落地。

### 0.3 Supervisor 与升级边界

Supervisor 不是接管者，首版只做指导者：

```ts
interface SupervisorAdvice {
  version: 1
  diagnosis: string
  failureClass:
    | "tool_format"
    | "wrong_strategy"
    | "missing_context"
    | "verification_failure"
    | "goal_drift"
    | "provider_failure"
    | "unknown"
  nextActions: string[]
  constraints: string[]
  verification: string[]
  confidence: number
  shouldContinue: boolean
  requiresUser?: boolean
}
```

硬边界：

- Supervisor 请求不携带工具 schema。
- Supervisor 不能产生可直接执行的 shell 命令对象或 patch 对象；其输出只是建议。
- Worker 必须通过现有工具权限、stale-read、敏感路径和 verification gate。
- 发给远程 Supervisor 的内容必须是有上限的 evidence bundle，不发送完整仓库、完整会话、密钥或无关文件正文。
- 同一失败签名默认最多请求 Supervisor 2 次；无新证据时禁止重复请求。
- 免费池耗尽后不自动切付费模型。付费 Oracle 必须显式配置并遵循用户确认策略。

---

## 1. 开发规则

### 1.1 每次只领取一个闭环

1. 从“推荐领取顺序”领取一个任务编号。
2. 先阅读任务列出的 Deepreef 接入点、源项目文件和邻近测试。
3. 可直接搬的代码必须复制后适配；不要凭印象重写。
4. 先写失败测试，再做最小实现。
5. 运行目标测试、`bun run typecheck`、`bun test`、`git diff --check`。
6. 完成后从本文删除该任务，在 `DONE.md` 记录：
   - 复制了哪些源文件、类、函数或代码块。
   - 做了哪些 Deepreef 适配。
   - 哪些部分无法复制而新写，以及原因。
   - 验证命令和保留限制。

Deepreef、iceCoder、SmallCode 和 OpenCode 均为 MIT。复制源码时保留来源注释，并按 MIT 要求保留版权声明。

工作区可能已有其他 Agent 或用户改动。禁止用 `git reset --hard`、`git checkout --` 清理不属于当前任务的修改。

### 1.2 不可破坏的架构边界

| 边界 | 正确做法 | 禁止事项 |
|---|---|---|
| Core 与 TUI | `engine.submit()` 只产出 `AsyncGenerator<LoopEvent>` | Core import React/Ink |
| 工具执行 | 继续走 `StreamingToolExecutor`、权限和 `ToolContext.invokeTool()` | 建第二套 ToolRegistry 或绕过权限直接 Shell |
| 工具结果 | `ToolResult.content` 始终为字符串，错误使用 `isError` | 把对象直接塞进上下文 |
| 编辑安全 | 复用 stale-read、敏感路径和原子写边界 | 复制 SmallCode 的文件写入器替换 Deepreef 工具 |
| ModelTarget | provider/model/baseUrl/key policy 一起解析 | 只改 model 字符串却继续共享错误 client |
| Supervisor | 只输出 `SupervisorAdvice` | 首版让 Supervisor 调工具或直接接管 |
| 免费模型 | 用户手动选择 provider/model；记录健康状态供展示 | 自动切换 provider/model 或恢复 `free-auto` |
| 推理强度 | 用户明确选择 `off/open/high` | 自动改变 thinking/model/temperature/tier |
| Prefix cache | profile/plan/advice 放可变上下文 | 每轮改变 immutable system prompt/schema 顺序 |
| Checkpoint | additive、best-effort、原子写 | 替换 Session JSONL 或因写盘失败中止任务 |
| 权限 | 保留硬 deny；用户显式选择 safe/balanced/yolo；ask 可由前台确认或显式 yolo 自动批准 | 清空 deny、自动开启 yolo、给后台 Worker/Supervisor 静默放权 |
| 完成判定 | 代码改动后走 Verification Gate | 仅凭模型声称完成 |

### 1.3 统一验证命令

```bash
bun run typecheck
bun test
git diff --check
```

涉及远程免费模型的任务还必须提供默认跳过的 smoke test，只有显式环境变量开启时才发真实请求。CI 不得依赖免费接口稳定性。

---

## 2. 直接搬用清单

实施 Agent 应优先按下表复制。除 import、类型、工具名、事件映射、路径和 Deepreef 安全边界外，不重写核心算法。

| 能力 | 来源 | Deepreef 目标 | 适配要求 |
|---|---|---|---|
| Model profile | `smallcode/src/model/profiles.js`、`smallcode/profiles/*.toml` | `packages/core/src/model-profile/` | 转 TypeScript；支持项目配置覆盖；未知模型保守默认 |
| Read-before-write | `smallcode/src/tools/read_tracker.js` | `packages/core/src/read-before-write.ts` | 接到 `StreamingToolExecutor`；复用 workspace/path 规范化；不替换 stale-read |
| Early-stop | `smallcode/src/governor/early_stop.js` | `packages/core/src/early-stop.ts` | 搬 repetition/read-loop/patch-loop；去掉 SmallCode 专属工具名 |
| Plan anchor | `smallcode/src/session/plan_tracker.js` | `packages/core/src/task-ledger.ts` | 首版只用确定性 parse/serialize/format；不额外调用 LLM 提取 |
| 两阶段工具路由 | `smallcode/src/tools/two_stage_router.js` | `packages/core/src/tool-routing/` | 延后到 profile 稳定后；兼容 MCP 动态工具和 immutable prefix |
| Adaptive failure routing | `smallcode/src/model/adaptive_router.js` | `packages/core/src/model-routing/health.ts` | 只搬统计/阈值思想；决策加入角色、能力、成本、冷却 |
| Supervisor/升级配置 | `smallcode/bin/escalation.js`、`smallcode/src/model/reviewer.js` | `packages/core/src/supervisor/` | 不搬“强模型直接修复”；改成结构化 advice；复用 Deepreef ChatClient |
| BranchBudget | `iceCoder/src/harness/branch-budget.ts`、`branch-budget-path.ts` | `packages/core/src/governance/` | 先裁掉 takeover bypass 等后期字段；保留核心预算、snapshot、路径规范化 |
| Checkpoint v2 | `iceCoder/src/harness/checkpoint-engine.ts`、`types/runtime-checkpoint.ts` | `packages/core/src/checkpoint/` | additive 到 Deepreef session checkpoint；保留原子写和 recent 截断 |
| Shell 双轨 | `iceCoder/src/tools/shell-runtime-classifier.ts`、`background-task-manager.ts` | `packages/tools/src/` | 复用 Deepreef task manager、平台 backend、安全检查 |
| 参数 normalize/salvage | `iceCoder/src/tools/tool-arguments-normalizer.ts`、`tool-arguments-salvage.ts` | `packages/core/src/tool-arguments/` | 截断写入必须拒绝执行 |
| 文本 tool-call salvage | `iceCoder/src/harness/text-tool-call-salvage.ts` 及 parser | `packages/core/src/tool-calls/` | 先支持 JSON/XML/Hermes；清理用户可见流和历史 |
| Verification Gate | `iceCoder/src/harness/harness-verification-gate.ts`、`verification-digest.ts`、`task-state.ts` | `packages/core/src/governance/` | 与 TaskLedger/Checkpoint 合并；先做改动后验证门禁 |
| free/forced 决策 | `iceCoder/src/harness/supervisor/mode-decision-engine.ts` | `packages/core/src/governance/` | 等基础信号稳定后再搬 |
| Question 数据契约与生命周期 | `opencode/packages/opencode/src/question/index.ts`、`question/schema.ts`、`tool/question.ts`、`tool/question.txt` | `packages/core/src/question/`、`packages/tools/src/ask-user.ts` | 复制 QuestionInfo/Request/Answer、pending/deferred、ask/reply/reject/list 和工具输出语义；Effect 改为 Promise |
| Question 纯 UI 状态机 | `opencode/packages/opencode/src/cli/cmd/run/question.shared.ts` | `packages/tui/src/question-state.ts` | 主体复制；只改 Deepreef 类型和命名；不要在 React 组件中重写状态转换 |
| Permission 规则集与请求生命周期 | `opencode/packages/opencode/src/permission/index.ts`、`core/src/v1/config/permission.ts` | `packages/security/src/permission/`、`packages/core/src/permission/` | 复制 Rule/Request/Reply、pattern evaluate/fromConfig/merge、pending/approved、once/always/reject；Effect 改为 Promise |
| Permission 资源 pattern 提取 | `opencode/packages/opencode/src/tool/shell.ts` 及 read/edit/write/web/task 等工具中的 `ctx.ask()` pattern 构建 | `packages/core/src/permission/patterns/` | 复制 shell 命令扫描和资源 pattern 思路；适配 Deepreef 工具参数与平台 backend，不替换工具实现 |
| Permission TUI 交互 | `opencode/packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` | `packages/tui/src/PermissionPrompt.tsx` | 复制 once/always/reject 与 always 二次确认语义；用 React/Ink 适配渲染 |

明确不搬：

- iceCoder Web/Electron、宠物、session sidebar、产品文案、完整 file-memory、完整 TaskGraph 和首版 L1/L2 takeover。
- SmallCode BoneScript、Marrow/compiled 层、同步文件写入器、Playwright 隐身浏览、SQLite memory、整套 Contract UI。
- OpenCode 的 Effect Service 容器、EventV2Bridge、HTTP route/SDK 和 Solid/OpenTUI Question/Permission 组件树；只复制其数据契约、生命周期、pattern 规则和纯状态机，UI 用 Deepreef React/Ink 适配。
- 任何会替换 Deepreef MCP、Context、Session、权限、TUI 事件或工具实现的产品壳代码。

---

## 3. 推荐领取顺序

| 顺序 | 任务 | 依赖 | 结果 |
|---|---|---|---|
| ~~1~~ | ~~`RM-10` 删除 `free-auto` 自动免费模型路由~~ | 无 | ✅ 已完成 |
| ~~2~~ | ~~`RM-20` 删除自动推理强度调节~~ | RM-10 | ✅ 已完成 |
| ~~3~~ | ~~`RM-30` 删除 Token 用量预估专项代码~~ | RM-20 | ✅ 已完成 |
| ~~4~~ | ~~`QST-10` 复制适配 OpenCode Question 完整交互闭环~~ | RM-30 | ✅ 已完成 |
| ~~5~~ | ~~`PERM-10` 复制适配 OpenCode 权限规则、Auto Accept 与子 Agent 冒泡~~ | QST-10 | ✅ 已完成 |
| ~~6~~ | ~~`DRF-00` 基线与复制台账~~ | RM-10、RM-20、RM-30、QST-10、PERM-10 | ✅ 已完成 |
| ~~7~~ | ~~`DRF-10` ModelTarget 与角色化 client resolver~~ | DRF-00 | ✅ 已完成 |
| ~~8~~ | ~~`DRF-11` ModelProfile 与 HarnessProfile~~ | DRF-10 | ✅ 已完成 |
| ~~9~~ | ~~`DRF-20` 小模型基础护栏~~ | DRF-11 | ✅ 已完成 |
| ~~10~~ | ~~`DRF-30` BranchBudget 与 Runtime Checkpoint v2~~ | DRF-20 | ✅ 已完成 |
| ~~11~~ | ~~`DRF-31` 参数与文本 tool-call salvage~~ | DRF-20 | ✅ 已完成 |
| ~~12~~ | ~~`DRF-32` Shell 双轨执行~~ | DRF-20 | ✅ 已完成 |
| ~~13~~ | ~~`DRF-40` TaskLedger 与 Verification Gate~~ | DRF-30 | ✅ 已完成 |
| ~~14~~ | ~~`DRF-50` SupervisorAdvice 协议与触发器~~ | DRF-40 | ✅ 已完成 |
| ~~15~~ | ~~`DRF-51` 显式 Supervisor 池与配额/冷却~~ | DRF-50 | ✅ 已完成 |
| ~~16~~ | ~~`DRF-60` 监督指导回注与继续执行~~ | DRF-51 | ✅ 已完成 |
| ~~17~~ | ~~`DRF-70` 两阶段工具路由与 free/forced~~ | DRF-60 | ✅ 已完成 |
| ~~18~~ | ~~`DRF-80` Benchmark、overnight 与发布门禁~~ | 全部 | ✅ 已完成 |

> **融合主线已全部顺序完成**（RM-10 → DRF-80）。上述并行禁令仅适用于历史开发阶段，后续新任务不得破坏已落地产物。

---

## 4. 分阶段任务

### ~~RM-10：删除 `free-auto` 自动免费模型路由~~ ✅ 已完成

优先级：`P0 / 立即执行`。

目标：

- 完整删除 `free-auto` 虚拟 provider 和自动候选切换。
- 保留 Zen、Kilo、Mimo 及后续验证通过的免费 API/provider/model，全部由用户在 `/model` 或配置中手动选择。
- 当前手动选择的 provider 失败时直接报告错误，不静默切换到其他模型。

删除范围：

- `packages/core/src/free-auto/` 整个目录。
- `packages/core/src/engine.ts` 的 `FreeAutoClient`、`freeAutoClient`、虚拟 client 解析和切换分支。
- `packages/core/src/config.ts` 的 `free-auto` provider、`virtual` 仅为该功能存在的字段和相关分支；若仍有其他用途则保留通用字段。
- `packages/core/src/index.ts` 的 Free Auto exports。
- `packages/core/src/loop.ts` 中 `free-auto` 的 keyless/max-token 特判。
- `packages/tui/src/ModelPicker.tsx` 中 `free-auto` 选项。
- `packages/tui/src/bridge.tsx` 的 `free_auto_route` 状态消费，以及只为该状态存在的字段/UI。
- `packages/core/__tests__/free-auto-router.test.ts` 和 config/engine/TUI 中只验证 Free Auto 的测试。

保留并补测：

- Zen、Kilo 等免费 provider 仍能被用户明确选择并正常调用。
- keyless provider 不发送 Authorization header。
- `/model` 不再出现 `free-auto`，但仍显示各免费 provider/model。
- 历史 `.deepreef/last-config.json` 若保存了 `provider: "free-auto"`，加载时安全回退到默认手动 provider，并给出一次可读提示；不得崩溃或继续发送虚拟 model。
- `docs/kilo-llm7-free-auto-implementation-plan.md` 标记为历史/已废弃方案，不删除历史结论。
- `DONE.md` 保留历史实现记录，并新增删除记录；不要篡改历史。

验收命令：

```bash
bun test packages/core/__tests__/config.test.ts packages/core/__tests__/engine-tools.test.ts
bun test packages/tui
bun run typecheck
bun test
git diff --check
```

关闭条件：

- `rg "free-auto|FreeAuto|free_auto" packages` 只允许出现在明确的旧配置迁移兼容代码或迁移测试中。
- 用户仍可手动选择并使用免费模型 API。
- 不存在任何自动跨 provider/model failover。

> 已完成于 2026-06-11，详见 `DONE.md` 的 `RM-10` 章节。

### ~~RM-20：删除自动推理强度调节~~ ✅ 已完成

优先级：`P0 / 立即执行`，依赖 `RM-10`。

目标：

- 删除 `/thinking auto` 和所有运行时自动 thinking 切换。
- 删除 strategy tier 自动推荐及其对 model、temperature、reasoning、maxTurns 的覆盖。
- 保留用户显式选择的 `/thinking off|open|high`；一次 submit 内和跨 turn 都不得被运行时自动改变。
- 保留普通成本统计和 token 统计，但它们只用于展示，不驱动模型或推理参数切换。

删除范围：

- `packages/core/src/mode-selector.ts`
- `packages/core/src/mode-stats.ts`
- `packages/core/src/loop-helpers.ts` 中仅服务自动 thinking switch 的代码。
- `packages/core/src/strategy/tiers.ts`
- `packages/core/src/strategy/recommender.ts`
- `packages/core/src/engine.ts` 中 mode selector/stats、tier 状态、tier decision 和 strategy notify 接线。
- `packages/core/src/loop.ts` 中 auto thinking 分支、tier 参数覆盖、tier recommendation/estimate 事件。
- `packages/core/src/interface.ts` 中只服务 tier recommendation/decision 的事件和接口。
- `packages/core/src/index.ts` 的 strategy tier exports。
- TUI 中 `auto` 选项、`effectiveThinkingMode`、tier recommendation UI 和只为自动切换存在的状态。
- 自动推理和 strategy tier 专属测试。

保留并修改：

- `ThinkingMode` 改为 `"off" | "open" | "high"`。
- `provider-thinking.ts` 只负责把用户选择映射为 provider 参数，不做自动决策。
- `/thinking` 命令、设置持久化、Welcome/StatusBar 继续显示用户明确选择。
- 旧设置中 `thinkingMode: "auto"` 安全迁移为 `"off"`，显示一次迁移提示或日志。
- `docs/auto-reasoning-design.md` 标记为历史/已废弃方案；`DONE.md` 保留历史并记录删除。

禁止：

- 不要用 HarnessProfile 或后续 free/forced governance 重新引入自动 thinking/model/temperature 切换。
- `DRF-70` 的 free/forced 只控制治理强度、工具约束和 checkpoint 频率，不控制模型推理强度。

验收命令：

```bash
bun test packages/core/__tests__/provider-thinking.test.ts packages/core/__tests__/engine-tools.test.ts
bun test packages/tui/__tests__/commands.test.ts
bun run typecheck
bun test
git diff --check
```

关闭条件：

- `rg '"auto"|thinking_mode_switch|tier_recommendation|STRATEGY_TIERS|recommendTier' packages/core packages/tui` 不再发现自动推理/策略 tier 实现；与其他非推理 auto 功能同名的结果需人工判读。
- 用户选择 `off/open/high` 后，运行时不会自动改变。
- provider/model/temperature 不再被 strategy tier 覆盖。

### ~~RM-30：删除 Token 用量预估专项代码~~ ✅ 已完成

优先级：`P0`，依赖 `RM-20`。

目标：

- 删除独立的 Token 用量预估系统、Tokenizer Worker Pool、预估 token/s 展示和对应 benchmark。
- 保留 Provider 返回的真实 `promptTokens/completionTokens/cacheHitTokens/cacheMissTokens`。
- 保留 Context 防止超出窗口所需的最小内部预算保护，但它不得作为“Token 用量预估”功能对外展示。
- 保留基于真实 Provider usage 的成本统计和 cache 命中展示；不根据预估值计算费用。

删除范围：

- `packages/core/src/context/tokenizer-pool.ts`
- `packages/core/src/context/tokenizer-worker.js`
- `packages/core/__tests__/tokenizer-pool.test.ts`
- `packages/core/__tests__/token-estimator.test.ts`
- `packages/core/__tests__/benchmark.test.ts` 中 Token 预估、典型会话预测和 CJK/ASCII 精细化估算部分。
- `packages/core/src/interface.ts` 中未使用的 `token_estimate` LoopEvent 预留。
- TUI `StreamingCard` 中基于字符数计算 token/s 的逻辑、定时刷新和对应文案。
- CLI/Engine shutdown 中只为 Tokenizer Worker 存在的关闭接线和注释。
- 文档中把 Tokenizer Worker Pool 或 Token 用量预估描述为产品能力的内容。

Context 保留与重构：

1. 不得直接删除 Context 预算保护。`ContextManager` 仍必须在请求前防止 prefix/log/scratch 超过 `contextWindow`。
2. 将当前 `context/token-estimator.ts` 收敛并重命名为内部 `context/budget-estimator.ts`：
   - 只保留简单、确定性、同步的 `estimateContextBudget()` 与 fold/trim 所需 ratio。
   - 删除 `refinedEstimate()`、CJK/标点精细化、Worker fallback 和健康诊断。
   - 不从 `@deepreef/core` 公共入口导出。
   - 返回值和错误文案明确标记为 `estimated context budget`，不冒充真实 token usage。
3. `ContextManager.shutdown()` 不再负责 Tokenizer Worker；若没有其他异步资源则移除或保留幂等空实现以兼容生命周期。
4. Context 相关测试改为验证：
   - prefix 单独超窗仍拒绝。
   - trim/compact 仍在安全阈值触发。
   - tool-call/tool-result 原子组不被破坏。
   - 不再 mock TokenizerPool。

明确保留：

- `client.ts` 从 Provider usage 读取的真实 token/cache 字段。
- `loop.ts` 对真实 usage 的累计和 `usage` LoopEvent。
- `SessionStats` 中真实 prompt/completion/cache hit/cache miss。
- `StatusBar` 和 `/status` 中基于真实 Provider 数据计算的 cache 命中率。
- `pricing.ts` 基于真实 usage 的成本计算；未知或不返回 usage 的 Provider 显示 unknown/0，不使用预估补值。
- Provider/model 的 `contextWindow` 配置。

目标文件：

- 删除 `packages/core/src/context/tokenizer-pool.ts`
- 删除 `packages/core/src/context/tokenizer-worker.js`
- 将 `packages/core/src/context/token-estimator.ts` 收敛为 `packages/core/src/context/budget-estimator.ts`
- 修改 `packages/core/src/context/manager.ts`
- 修改 `packages/core/src/interface.ts`
- 修改 `packages/core/src/index.ts`
- 修改 `packages/core/src/engine.ts`
- 修改 `packages/cli/src/tui.ts`
- 修改 `packages/tui/src/reasonix/StreamingCard.tsx`
- 修改 Context、生命周期和 pricing 邻近测试

禁止：

- 不要删除 Provider 返回的真实 usage/cache 数据。
- 不要删除 Context 超窗保护或改成无限上下文。
- 不要用字符估算值填充真实 usage、成本或 cache 命中率。
- 不要在本任务中修改 Provider、thinking、Supervisor 或 Question 交互。

验收命令：

```bash
rg "TokenizerPool|tokenizer-worker|refinedEstimate|token_estimate|CHARS_PER_TOKEN" packages/core packages/tui packages/cli
bun test packages/core/__tests__/context.test.ts packages/core/__tests__/context-summary.test.ts packages/core/__tests__/engine-context-policy.test.ts
bun test packages/core/__tests__/benchmark.test.ts packages/core/__tests__/engine-status.test.ts
bun test packages/tui
bun run typecheck
bun test
git diff --check
```

关闭条件：

- `TokenizerPool`、worker、精细 Token 预估和 TUI token/s 猜测已删除。
- Context 预算、trim/compact 和超窗保护仍通过测试。
- 真实 usage、cache hit/miss 和基于真实 usage 的成本统计未回归。
- `DONE.md` 记录删除事实与保留边界，不再把 Token 用量预估列为当前能力。

### ~~QST-10：复制适配 OpenCode Question 完整交互闭环~~ ✅ 已完成

优先级：`P0`，依赖 `RM-30`。

问题：

Deepreef 已有 `packages/tools/src/ask-user.ts` 和 `AskUserQuestion` 工具，但当前工具只返回问题 JSON。Core/TUI 不会展示问题、暂停执行或等待用户回答，模型收到的是自己的问题结构，而不是真实用户答案。Plan Agent 和 Subagent 因此无法可靠澄清需求。

目标：

- Agent 调用 Question 工具后，当前工具调用暂停，TUI 展示问题面板。
- 用户回答、提交或拒绝后，工具调用恢复，并把真实答案作为 tool result 返回给原 Agent。
- 支持单问题、多问题、单选、多选、自定义回答和拒绝。
- 主 Agent、Plan Agent 和 Subagent 都能提问；Subagent 的问题必须冒泡到主 TUI。
- 中断、shutdown、Session 切换和 TUI 退出时不得遗留 pending Promise。

必须复制并适配：

| 来源 | 复制内容 | Deepreef 目标 |
|---|---|---|
| `/vol4/Agent/opencode/packages/opencode/src/question/index.ts` | `Option`、`Info`、`Request`、`Answer`、pending map、ask/reply/reject/list、finalizer reject 语义 | `packages/core/src/question/types.ts`、`packages/core/src/question/service.ts` |
| `/vol4/Agent/opencode/packages/opencode/src/question/schema.ts` | Question ID 前缀和生成语义 | `packages/core/src/question/id.ts` |
| `/vol4/Agent/opencode/packages/opencode/src/tool/question.ts` | questions 参数结构、答案格式化和 tool result 文案 | 替换 `packages/tools/src/ask-user.ts`，工具名兼容见下文 |
| `/vol4/Agent/opencode/packages/opencode/src/tool/question.txt` | 使用说明、custom/multiple/recommended 规则 | Question 工具 description 或独立 prompt 文本 |
| `/vol4/Agent/opencode/packages/opencode/src/cli/cmd/run/question.shared.ts` | 纯状态机：single/multi、tab、select、toggle、custom、submit、reject、hint | `packages/tui/src/question-state.ts` |
| `/vol4/Agent/opencode/packages/opencode/src/cli/cmd/tui/routes/session/question.tsx` | 问题面板信息结构和交互布局 | `packages/tui/src/QuestionPrompt.tsx`，使用 React/Ink 重做渲染壳 |

复制规则：

1. OpenCode 为 MIT；复制文件或大段代码时在新文件顶部保留来源与 MIT 说明，并在 `docs/fusion-copy-ledger.md` 记录。
2. 数据契约、pending 生命周期、答案格式和纯状态机必须以复制适配为主，不得凭印象从头重写。
3. 不引入 OpenCode 的 `effect`、`EventV2Bridge`、HTTP route、SDK、Solid 或 OpenTUI 依赖。
4. `QuestionPrompt.tsx` 只能适配渲染和 Deepreef 键盘组件；状态转换必须调用复制后的 `question-state.ts`。

Deepreef 接入设计：

1. 新增 Question Core 类型：

```ts
interface QuestionOption {
  label: string
  description: string
}

interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

interface QuestionRequest {
  id: string
  sessionId: string
  questions: QuestionInfo[]
  tool?: { toolCallId: string; toolName: string }
  parentSessionId?: string
}

type QuestionAnswer = string[]
```

2. `QuestionService` 归 Core/Engine 生命周期管理：
   - `ask()` 创建 pending Promise，发布 `question_ask` LoopEvent，然后等待回答。
   - `reply()`、`reject()`、`list()` 复制 OpenCode 语义。
   - 同一 Engine 首版最多允许一个 pending Question；重复提问返回明确错误，不能覆盖旧 Promise。
   - `interrupt()`、`shutdown()`、Session 切换和 child engine 结束时统一 reject/cleanup。

3. 扩展 Deepreef 事件和 Engine API：
   - `LoopEventRole` 新增 `question_ask`、`question_replied`、`question_rejected`。
   - `CoreEngine` 新增 `respondQuestion(requestId, answers)`、`rejectQuestion(requestId)`。
   - Question 等待期间 `submit()` 保持活跃，但不得继续后续模型请求或执行同批其他 exclusive 工具。
   - Question 事件必须实时 yield，不能等工具执行结束后从缓冲 progress 中一次性 flush。

4. 扩展 `ToolContext`：
   - 新增 `askUser(questions): Promise<QuestionAnswer[]>`。
   - Question 工具只负责参数验证、调用 `ctx.askUser()` 和格式化答案，不自己管理全局 pending 状态。
   - 不允许通过普通 `reportProgress()` 冒充 Question 交互。

5. 工具兼容：
   - 新规范工具名使用 `Question`，与 OpenCode 复制代码和后续模型 profile 对齐。
   - 暂时保留 `AskUserQuestion` alias，内部委托同一实现；后续 benchmark 确认无兼容需求后再删除 alias。
   - 将 Question 加入 Plan mode 只读工具集。
   - 工具 `approval` 保持 `read`，但 Question 是交互阻塞点，不等同于 Permission。

6. TUI：
   - `BridgeState` 新增 `questionPrompt`；bridge 消费 `question_ask/replied/rejected`。
   - `QuestionPrompt.tsx` 支持 ↑↓、数字键、Enter、Esc、Tab/Shift+Tab、自定义文本。
   - Question 打开时禁用普通 PromptInput 和 autocomplete；回答或拒绝后恢复。
   - Question 与 PermissionPrompt 不得同时覆盖；若出现冲突，保留先到请求并对后到请求 fail-fast。
   - cancel 必须先 reject pending Question，再 interrupt engine。

7. Subagent：
   - child Question 通过 parent engine 冒泡到主 TUI，request 中保留 child session/run 标识。
   - 主 TUI 回答后，答案回到发起问题的 child Question Promise。
   - 后台无交互端的 Subagent 调用 Question 时必须 fail-fast，不能永久等待。

目标文件：

- 新增 `packages/core/src/question/id.ts`
- 新增 `packages/core/src/question/types.ts`
- 新增 `packages/core/src/question/service.ts`
- 修改 `packages/core/src/interface.ts`
- 修改 `packages/core/src/engine.ts`
- 修改 `packages/core/src/streaming-executor.ts`
- 修改 `packages/core/src/subagent/run.ts`
- 修改 `packages/tools/src/ask-user.ts`
- 修改 `packages/tools/src/index.ts`
- 修改 `packages/core/src/main-mode.ts`
- 新增 `packages/tui/src/question-state.ts`
- 新增 `packages/tui/src/QuestionPrompt.tsx`
- 修改 `packages/tui/src/bridge.tsx`
- 修改 `packages/tui/src/App.tsx`

禁止：

- 不要只把问题 JSON显示成 warning/status 后立即返回。
- 不要让普通用户输入队列偷偷充当 Question 回答。
- 不要复制 OpenCode 的 Effect、HTTP API、SDK 或 Solid/OpenTUI 组件树。
- 不要建立绕过 LoopEvent 的 Core→TUI 直接回调。
- 不要在 Question 功能中顺带实现 Supervisor、后台任务面板或新的 Permission 系统。

测试：

- 从 OpenCode `question.shared.ts` 对应行为复制状态机测试：单选立即提交、多选 toggle、多问题 tab/confirm、自定义答案、拒绝。
- Core：ask/reply/reject/list、未知 request、重复 pending、interrupt/shutdown cleanup。
- Executor：Question 事件先于答案结果产出；回答前不继续 exclusive 工具；拒绝后写入明确 tool error。
- TUI：QuestionPrompt 键盘行为、普通输入禁用、回答/拒绝恢复、Permission 冲突。
- Subagent：问题冒泡、回答回传、无交互端 fail-fast。

验收命令：

```bash
bun test packages/core/__tests__/question-service.test.ts
bun test packages/core/__tests__/question-integration.test.ts
bun test packages/tools/__tests__/ask-plan-mode.test.ts
bun test packages/tui/__tests__/question-state.test.ts
bun test packages/tui
bun run typecheck
bun test
git diff --check
```

关闭条件：

- Agent 调用 Question 后，真实暂停等待用户，回答后从同一工具调用继续。
- 单选、多选、多问题、自定义回答和拒绝均可用。
- Plan Agent 与前台 Subagent 可以提问；无交互端不会永久挂起。
- interrupt/shutdown 后 `QuestionService.list()` 为空，没有悬挂 Promise。
- 复制来源、适配点和 MIT 处理已记录到 `docs/fusion-copy-ledger.md`。

### ~~PERM-10：复制适配 OpenCode 权限规则、Auto Accept 与子 Agent 冒泡~~ ✅ 已完成

优先级：`P0`，依赖 `QST-10`。

问题：

Deepreef 当前 `PermissionEngine` 仅支持 deny-first 的工具名和参数完全相等匹配；read/write 默认允许，exec 默认询问。TUI 已有“允许 / 始终允许 / 拒绝”，但“始终允许”会在当前 Engine 内放行该工具的所有参数，不能精确限制到命令或路径，也不会持久化。子 Agent 的 `bubble` 当前只是返回允许，没有真正把权限请求冒泡给父 TUI；child exec 请求可能无人响应而永久等待。

目标：

- 保留 Deepreef deny-first、安全工具内联检查、敏感路径、stale-read 和 PermissionEngine 接入点。
- 复制适配 OpenCode 的 `permission + resource pattern + allow/ask/deny` 规则、pending request 和 `once/always/reject` 生命周期。
- 提供用户显式选择的 `safe / balanced / yolo` 三种权限模式。
- `yolo` 只自动批准原本为 `ask` 的请求；显式 deny、危险命令 denylist、敏感路径、外部目录限制、子 Agent 限制和 Hook deny 永远不能被绕过。
- 主 Agent、前台子 Agent、后台 Worker 和 Plugin 工具使用同一权限规则与请求服务；需要用户确认但没有交互端时 fail-fast 或 checkpoint 暂停，不能挂起。

必须复制并适配：

| 来源 | 复制内容 | Deepreef 目标 |
|---|---|---|
| `/vol4/Agent/opencode/packages/opencode/src/permission/index.ts` | `evaluate()`、`fromConfig()`、`merge()`、pending/approved map、ask/reply/list、once/always/reject 和 finalizer cleanup | `packages/security/src/permission/rules.ts`、`packages/core/src/permission/service.ts` |
| `/vol4/Agent/opencode/packages/core/src/v1/config/permission.ts` | `allow/ask/deny` 配置契约、全局字符串和按 permission/pattern 对象语义 | `packages/core/src/schemas/permission.ts` |
| `/vol4/Agent/opencode/packages/opencode/src/tool/shell.ts` | shell command pattern 扫描、external directory pattern 和 always 建议 | `packages/core/src/permission/patterns/shell.ts` |
| `/vol4/Agent/opencode/packages/opencode/src/tool/read.ts`、`edit.ts`、`write.ts`、`webfetch.ts`、`task.ts`、`skill.ts` | 各能力的 `patterns` / `always` 构建方式 | `packages/core/src/permission/patterns/` |
| `/vol4/Agent/opencode/packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` | once/always/reject、always 二次确认和 reject 反馈语义 | `packages/tui/src/PermissionPrompt.tsx` |
| `/vol4/Agent/opencode/packages/opencode/src/agent/subagent-permissions.ts` | 父级 deny 与外部目录限制向子 Agent 传播的思路和回归测试 | `packages/core/src/subagent/permission.ts`、子 Agent runner |

复制规则：

1. 复制规则数据结构、匹配算法、请求生命周期和邻近测试；不要凭印象重新设计。
2. 不引入 OpenCode 的 Effect、EventV2Bridge、HTTP route、SDK、Solid/OpenTUI 或数据库层。
3. OpenCode 的“最后匹配规则生效”适合用户配置和 agent override；Deepreef 工具内联硬拒绝、安全 deny 和父级限制必须在规则求值前或最终执行前再次强制，不能被后续 allow 覆盖。
4. OpenCode shell pattern 提取需适配 Deepreef 的 bash/PowerShell backend；不得替换 `packages/tools/src/shell-exec.ts` 的执行、危险命令和敏感文件检查。
5. 复制文件或大段代码时保留来源与 MIT 说明，并更新 `docs/fusion-copy-ledger.md`。

Deepreef 接入设计：

1. 统一规则与请求契约：

```ts
type PermissionAction = "allow" | "ask" | "deny"

interface PermissionRule {
  permission: string
  pattern: string
  action: PermissionAction
  source: "hard" | "config" | "agent" | "session"
}

interface PermissionRequest {
  id: string
  sessionId: string
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
  tool?: { toolCallId: string; toolName: string }
  parentSessionId?: string
}

type PermissionReply = "once" | "always" | "reject"
type PermissionMode = "safe" | "balanced" | "yolo"
```

2. 权限能力名与资源 pattern：
   - `read`：文件路径。
   - `edit`：统一覆盖 `edit/write_file/NotebookEdit/patch`，pattern 为文件路径。
   - `bash`：解析后的命令 pattern；无法安全解析时使用完整命令并保持 `ask`。
   - `external_directory`：工作区外路径，默认 `ask`。
   - `webfetch/websearch`：URL 或 query。
   - `task`：子 Agent 类型。
   - `skill`：skill 名。
   - `plugin:<pluginId>:<tool>` 与 `mcp:<server>:<tool>`：默认遵循配置，未知能力在 `safe/balanced` 下不得静默执行高风险操作。
   - `doom_loop`：相同工具和参数重复达到阈值时强制 `ask`，后续可与 EarlyStop 合并。

3. 模式定义：

| 模式 | 默认行为 | 边界 |
|---|---|---|
| `safe` | read 允许；write/exec/external/plugin 高风险操作询问 | 适合陌生仓库与前台交互 |
| `balanced` | 保持当前体验：read/write 允许；exec/external 询问 | 默认模式 |
| `yolo` | 自动回复 `once` 批准所有 `ask` | 必须用户显式开启；不能覆盖任何 deny 或工具内联安全检查 |

4. 配置与 UI：
   - 项目级配置建议使用 `.deepreef/permissions.json`，以 Zod 4/Standard Schema 验证；支持全局 action 和按 permission/pattern 规则。
   - CLI/TUI 提供显式 `/permissions` 或等价设置入口切换模式和查看当前规则；StatusBar 必须持续显示 `safe/balanced/yolo`。
   - `yolo` 开启时显示危险提示和二次确认；不允许 Plugin、模型、Supervisor 或子 Agent 自行开启。
   - `PermissionPrompt` 显示 permission、资源 patterns、来源和建议的 always patterns；选择 always 前二次确认授权范围。
   - `always` 首版只进入当前运行时 session approved rules，重启失效；持久化 always 后置，避免误授权长期保存。

5. 权限执行顺序：

```text
工具内联硬拒绝 / 敏感路径 / 父级硬限制
  -> PermissionRule evaluate
  -> beforeToolCall Hook（Hook deny 永远生效）
  -> allow / ask / deny
  -> yolo 仅把 ask 自动回复 once
  -> 工具执行前再次执行内联安全检查
```

   - 修复当前 `beforeToolCall` 只在 `ask` 时运行的问题；Hook 必须可以拒绝默认 allow 的 read/write/plugin 工具。
   - Hook 返回 allow 不得覆盖规则 deny 或硬拒绝。
   - `ToolContext.invokeTool()`、Workflow 嵌套工具、MCP、Plugin 工具必须使用同一求值入口，不能依靠外层工具一次批准后绕过内部资源权限。

6. 子 Agent：
   - child 必须继承父级硬 deny、用户配置规则和目录边界；子 Agent 定义只能进一步收紧，不能扩大父权限。
   - `readonly`：拒绝 write/exec。
   - `denyExec`：拒绝 exec。
   - `acceptEdits`：允许 read/write，exec 仍按父规则或询问；不得像当前实现一样无条件允许 exec。
   - `bubble`：真正把 PermissionRequest 冒泡到父 Engine/TUI，回答回传到 child Promise。
   - 后台无交互 Worker 遇到 `ask` 时 fail-fast 或保存 checkpoint 后暂停；不得自动 yolo、不得永久等待。
   - 删除或改写当前仅断言 `bubble/acceptEdits` “允许所有工具”的错误测试。

7. 与 Question 的关系：
   - Permission 与 Question 使用相同的 pending request 生命周期基础设施或明确共享的交互调度器，避免两套清理/冲突逻辑。
   - PermissionPrompt 与 QuestionPrompt 不得同时覆盖；请求按队列处理或对不可处理请求 fail-fast。
   - interrupt、shutdown、Session 切换和 TUI 退出必须 reject/cleanup 全部 pending 权限请求。

目标文件：

- 重构 `packages/security/src/permission.ts` 为兼容 facade；新增 `packages/security/src/permission/rules.ts`
- 新增 `packages/core/src/permission/types.ts`
- 新增 `packages/core/src/permission/service.ts`
- 新增 `packages/core/src/permission/patterns/`
- 新增 `packages/core/src/schemas/permission.ts`
- 修改 `packages/core/src/engine.ts`
- 修改 `packages/core/src/streaming-executor.ts`
- 修改 `packages/core/src/executor-helpers.ts`
- 修改 `packages/core/src/interface.ts`
- 修改 `packages/core/src/subagent/permission.ts`
- 修改 `packages/core/src/subagent/run.ts`
- 修改 `packages/tools/src/shell-exec.ts` 及需要提供资源 pattern 的工具适配点
- 修改 `packages/plugin/src/tool-adapter.ts`、MCP 工具适配点
- 修改 `packages/tui/src/PermissionPrompt.tsx`
- 修改 `packages/tui/src/bridge.tsx`
- 修改 `packages/tui/src/App.tsx`、`StatusBar.tsx` 和命令注册

禁止：

- 不要把 `yolo` 实现为清空 deny rules、直接绕过 PermissionEngine 或给工具传 bypass。
- 不要允许模型、Plugin、Supervisor、HarnessProfile 或后台 Worker 自动开启 `yolo`。
- 不要把 `always` 简化为按工具名全部放行。
- 不要让 Hook allow 覆盖显式 deny、安全 deny 或父级限制。
- 不要让 child engine 丢失父级权限，或把 `bubble` 实现成无条件 allow。
- 不要删除 shell 内联危险命令、敏感路径、stale-read、FileSnapshot 或 PermissionEngine facade。
- 不要在本任务中实现 Supervisor、BranchBudget 或新的工具执行器。

测试：

- 从 OpenCode permission 邻近测试复制：pattern 匹配、最后匹配生效、fromConfig、merge、unknown 默认、pending ask/reply/list、once/always/reject、cleanup。
- Deepreef 硬边界：显式 deny 在三种模式中均不可覆盖；Hook deny 不可覆盖；危险命令和敏感路径在 yolo 下仍拒绝。
- 模式：safe/balanced/yolo 默认矩阵、用户显式切换、StatusBar 显示、yolo 二次确认。
- always：只批准建议 pattern、同 session 生效、重启失效、并发 pending 自动完成符合 pattern 的请求。
- 嵌套工具：Workflow、`ToolContext.invokeTool()`、Plugin、MCP 不绕过权限。
- 子 Agent：父 deny 继承、readonly/denyExec/acceptEdits、bubble 请求和回答回传、后台无交互 fail-fast。
- 生命周期：interrupt/shutdown/session 切换后 pending 为空；Permission 与 Question 冲突不挂起。

验收命令：

```bash
bun test packages/security/__tests__/permission.test.ts
bun test packages/core/__tests__/permission-service.test.ts packages/core/__tests__/permission-integration.test.ts
bun test packages/core/__tests__/subagent-permission.test.ts packages/core/__tests__/subagent-run.test.ts
bun test packages/tui/__tests__/permission-prompt.test.ts packages/tui/__tests__/bridge.test.ts
bun test packages/tools/__tests__/bash.test.ts packages/tools/__tests__/edit-integration.test.ts
bun run typecheck
bun test
git diff --check
```

关闭条件：

- `safe/balanced/yolo` 均由用户明确选择并按定义工作；默认保持 `balanced`。
- `yolo` 仅自动批准 ask，无法覆盖任何 deny、Hook deny 或工具内联安全拒绝。
- “始终允许”按资源 pattern 生效，不再按整个工具名无限放行。
- Plugin、MCP、Workflow、嵌套工具和子 Agent 不绕过统一权限入口。
- `bubble` 真正冒泡到父 TUI；后台无交互请求不会永久等待。
- interrupt/shutdown 后权限 pending 列表为空。
- 复制来源、适配点、测试和 MIT 处理已记录到 `docs/fusion-copy-ledger.md`。

### ~~DRF-00：基线、来源审计与复制台账~~ ✅ 已完成

优先级：`P0`。

目标：

- 固化当前 Deepreef 行为和测试基线。
- 建立 `docs/fusion-copy-ledger.md`，逐项记录来源、目标、复制范围、适配点和许可证。
- 核对本文所有来源文件实际存在；不存在的引用先修正文档。

执行：

1. 在 `RM-10`、`RM-20`、`RM-30`、`QST-10`、`PERM-10` 完成后运行 `bun run typecheck`、`bun test`、`git diff --check` 并记录基线。
2. 为 Worker/Supervisor 模型调用、subagent、显式免费 provider、工具执行和 context 绘制最小调用图。
3. 在复制台账中为每个来源标注：
   - `copy`: 主体可直接复制。
   - `adapt`: 复制主体，只改接口。
   - `reference-only`: 只借鉴策略，不能直接搬。
4. 确认 Deepreef、iceCoder、SmallCode MIT 声明处理方式。

关闭条件：

- 后续任务不再引用不存在的源文件。
- 基线失败项被记录，后续 Agent 不误判为本次回归。

### ~~DRF-10：ModelTarget 与角色化 client resolver~~ ✅ 已完成

优先级：`P0`。

问题：

当前 subagent child engine共享父级 `client`。只传 `model` 无法切换到本地端点或用户配置的远程 Supervisor provider，这是监督架构的阻塞项。

建议类型：

```ts
interface ModelTarget {
  id: string
  role: "worker" | "supervisor" | "oracle" | "summarizer"
  provider: string
  model: string
  baseUrl: string
  apiKeyPolicy: "keyless" | "provider-env" | "explicit"
  contextWindow?: number
  maxTokens?: number
  temperature?: number
}
```

实施：

1. 新增集中 `resolveModelTarget()` 和 `createClientForTarget()`。
2. `ReasonixEngine` 不再假设所有 child 共享同一 client；允许 child 按 target 建立 client，同时保留测试注入 custom client 的能力。
3. 扩展 `SubagentDefinition` / `SubagentRunOptions`，支持 `target?: string`；保留 `model` 兼容字段并标记其局限。
4. 配置至少支持：
   - `worker.local`
   - `supervisor.zen-free`
   - `oracle.optional`
5. provider/base URL/API key 不写入 checkpoint 和日志。

目标文件：

- `packages/core/src/config.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/subagent/types.ts`
- `packages/core/src/subagent/run.ts`
- `packages/core/src/subagent/definition.ts`
- 新增 `packages/core/src/model-target.ts`

验收：

- 父级使用远程模型时，Worker 可明确使用本地 OpenAI-compatible endpoint。
- 父级使用本地模型时，Supervisor 可明确使用用户配置的 Zen/Kilo/Mimo 等目标。
- target 切换同时改变 client/provider/baseUrl/model，不是只改 model 字符串。
- 未配置 target 时行为与当前一致。

### ~~DRF-11：ModelProfile 与 HarnessProfile~~ ✅ 已完成

优先级：`P0`。

直接复制：

- `smallcode/src/model/profiles.js`
- `smallcode/profiles/qwen3-8b.toml`
- `smallcode/profiles/qwen2.5-coder-14b.toml`
- `smallcode/profiles/devstral-small.toml`

建议类型：

```ts
interface ModelProfile {
  id: string
  match: string[]
  sizeClass: "small" | "medium" | "large" | "unknown"
  contextWindow: number
  maxOutputTokens: number
  toolFormat: "native" | "hermes" | "json" | "xml" | "text"
  toolCallReliability: "low" | "medium" | "high"
  jsonReliability: "low" | "medium" | "high"
  strengths: string[]
  weaknesses: string[]
  defaultHarness: string
}

interface HarnessProfile {
  id: string
  mode: "free" | "adaptive" | "forced" | "strict"
  toolset: "none" | "minimal" | "coding" | "full"
  maxParallelTools: number
  maxTurns: number
  requireReadBeforeWrite: boolean
  enableTextToolSalvage: boolean
  enableBranchBudget: boolean
  requireVerificationBeforeFinal: boolean
  shellPolicy: "foreground" | "dual-track"
  supervisorPolicy: "off" | "on-failure" | "strict"
}
```

首版内置 profile：

| Profile | 用途 |
|---|---|
| `local-small-strict` | 7B-20B 本地 Worker；最小工具、单/双工具并发、强护栏 |
| `local-medium-forced` | 20B-35B 本地 Worker；允许更多工具，仍要求验证 |
| `remote-adaptive` | 中/大模型普通执行；free 起步，失败后 forced；不改变 thinking/model/temperature |
| `supervisor-advice-only` | 无工具、短输出、结构化 advice |
| `free-chat` | 问答，不启用任务治理 |

规则：

- 项目配置覆盖内置 profile。
- 未知本地模型使用保守 `local-small-strict`，未知远程模型使用 `remote-adaptive`。
- profile 只影响可变 runtime policy，不频繁改变 immutable prefix。

### ~~DRF-20：小模型基础护栏~~ ✅ 已完成

优先级：`P0`。

直接复制并适配：

- `smallcode/src/tools/read_tracker.js`
- `smallcode/src/governor/early_stop.js`

实施：

1. Read-before-write 接入工具执行前检查：
   - 已存在且本轮未读的文件，首次写入返回指导性 error。
   - 默认第二次仍不应绕过 Deepreef stale-read；是否允许覆盖由现有编辑安全规则决定。
2. EarlyStop 搬入：
   - streaming repetition。
   - read-only streak。
   - 同文件 patch spiral。
   - mid-task greeting/context-loss。
3. 根据 HarnessProfile 限制 Worker 工具集和并发。
4. 所有触发生成结构化 runtime signal，供后续 Supervisor 使用。

禁止：

- 不复制 SmallCode 同步写文件或 shell 实现。
- 不因 early-stop 直接宣告任务失败；先产生 recovery signal。

### ~~DRF-30：BranchBudget 与 Runtime Checkpoint v2~~ ✅ 已完成

优先级：`P0`。

直接复制并裁剪：

- `iceCoder/src/harness/branch-budget.ts`
- `iceCoder/src/harness/branch-budget-path.ts`
- `iceCoder/src/harness/checkpoint-engine.ts`
- `iceCoder/src/types/runtime-checkpoint.ts`
- 对应 `test/harness/branch-budget*.test.ts`、`checkpoint-engine*.test.ts`

首版保留：

- 同文件编辑默认最多 3 次。
- 同一失败命令默认最多 2 次。
- 同一错误签名默认最多 3 次。
- snapshot/restore。
- recent tools 最多 20、failures 最多 10。
- 临时文件 + rename、best-effort 写盘。

首版裁掉：

- takeover bypass、TaskGraph、Supervisor phase、复杂 acceptance tracker 字段。
- iceCoder 主 Harness 接线。

Checkpoint 增加但不替换 `.deepreef/sessions/*.jsonl`，保存：

- Worker target/profile/harness ID，不保存 key/baseUrl。
- TaskLedger 摘要。
- branch budget。
- recent tools/failures。
- verification pending/result。
- 最近 SupervisorAdvice 摘要与 evidence hash。
- 免费 Supervisor cooldown/配额摘要。

### ~~DRF-31：工具参数与文本 tool-call salvage~~ ✅ 已完成

优先级：`P0/P1`。

直接复制并适配：

- `iceCoder/src/tools/tool-arguments-normalizer.ts`
- `iceCoder/src/tools/tool-arguments-salvage.ts`
- `iceCoder/src/harness/text-tool-call-salvage.ts`
- `iceCoder/src/harness/text-format-tool-call-parsers.ts`

实施顺序：

1. 参数 wrapper 展开和别名 normalize。
2. 截断 JSON 字段 salvage；截断写入永远拒绝真实执行。
3. 非原生 tool call 的 JSON/XML/Hermes 文本解析。
4. 流式用户可见内容和历史清理，避免把工具调用正文展示/重复注入。
5. 每个 ModelProfile 可开启/关闭对应格式。

关闭条件：

- 本地小模型正文中的合法工具意图可执行。
- 不完整写入不会落盘。
- 原生 tool_calls 行为不退化。

### ~~DRF-32：Shell 双轨执行~~ ✅ 已完成

优先级：`P1`。

直接复制并适配：

- `iceCoder/src/tools/shell-runtime-classifier.ts`
- `iceCoder/src/tools/background-task-manager.ts`
- `iceCoder/src/tools/builtin/shell-tool.ts` 中的 `check/list/stop` 和软超时思路

目标：

- short 前台执行。
- long 默认后台。
- auto 超过软超时升级后台。
- `check/list/stop` 支持增量 cursor。

必须复用：

- Deepreef `shell-exec.ts`
- Deepreef `task-manager.ts`
- Deepreef 平台 backend、危险命令检查、权限、进程树终止。

### ~~DRF-40：TaskLedger 与 Verification Gate~~ ✅ 已完成

优先级：`P0/P1`。

来源：

- 复制 SmallCode `src/session/plan_tracker.js` 的确定性 plan parse/serialize/format。
- 复制 iceCoder `task-state.ts`、`verification-digest.ts`、`harness-verification-gate.ts` 的最小字段和门禁思想。
- SmallCode `src/session/contract.js` 仅作 Definition of Done 参考，不复制整套文件布局。

首版 `TaskLedger`：

```ts
interface TaskLedger {
  goal: string
  plan: Array<{ id: string; text: string; status: "pending" | "active" | "done" | "blocked" }>
  changedFiles: string[]
  commandsRun: Array<{ commandHash: string; success: boolean }>
  verificationPending: boolean
  lastVerification?: { command: string; exitCode: number; summary: string }
  blockers: string[]
}
```

规则：

- 复杂 edit/debug/refactor/test 任务创建 ledger；question/inspect 不创建。
- 计划锚点注入可变上下文，压缩后从 checkpoint 恢复。
- 任意代码写入后 `verificationPending = true`。
- final 前若 verification pending，模型必须继续验证或明确请求用户豁免。
- 验证失败是 Supervisor 触发信号，不是自动反复重跑同一命令。

### ~~DRF-50：SupervisorAdvice 协议、EvidenceBundle 与触发器~~ ✅ 已完成

优先级：`P0`。

参考并适配：

- `smallcode/bin/escalation.js`
- `smallcode/src/model/reviewer.js`
- `smallcode/src/model/adaptive_router.js`
- iceCoder runtime signals、BranchBudget 和 verification failure 触发思路

新增：

```ts
interface EvidenceBundle {
  goal: string
  activeStep?: string
  failureClass: string
  recentFailures: Array<{ signature: string; summary: string }>
  recentTools: Array<{ name: string; success: boolean; summary: string }>
  changedFiles: string[]
  verification?: { command: string; exitCode: number; tail: string }
  attemptedStrategies: string[]
}
```

触发器：

- BranchBudget block。
- 同错误签名达到阈值。
- verification 连续失败。
- tool-call salvage 连续失败。
- read loop / patch spiral / repetition / greeting regression。
- Worker 明确输出结构化 `ask_supervisor`。
- goal drift 或 TaskLedger 无进展。

不触发：

- 单次普通工具失败。
- provider 429；应先走 provider failover/cooldown。
- 没有新增 evidence 的同一失败。
- 用户刚明确要求继续同一策略时。

Supervisor 输出必须用 schema 验证；解析失败可重试一次，仍失败则记录 unavailable 并回到 Worker/用户。

### ~~DRF-51：显式 Supervisor 池、能力目录和预算~~ ✅ 已完成

优先级：`P0/P1`。

不要把 Supervisor 池硬编码成某几个永久免费的模型。新增角色化目录：

```ts
interface SupervisorCandidate {
  id: string
  target: string
  priority: number
  capabilities: {
    structuredJson: boolean
    reasoningText: boolean
    maxEvidenceTokens: number
  }
  costClass: "free" | "free-tier" | "paid"
  enabled: boolean
}
```

首版候选策略：

- 优先使用已配置且 smoke test 通过的 `deepseek-v4-flash-free`、`mimo-v2.5-free`。
- Supervisor 候选必须由用户显式配置为具体 provider/model target；不得使用虚拟自动路由 target。
- StepFun 3.5 作为配置候选，不在未验证时默认启用。先提供显式 smoke test；记录真实 model ID、响应格式、限额和空文本风险后再进入默认目录。
- 付费 DeepSeek/MiMo/其他模型只能进入可选 `oracle`，不自动消费。

路由评分至少包含：

- role capability。
- provider/model cooldown。
- 最近结构化输出成功率。
- 最近延迟。
- 同 failure signature 是否已询问。
- session 次数预算、token 预算、成本类别。

默认预算建议：

- 同 failure signature 最多 2 次。
- 每 session 免费 Supervisor 最多 8 次。
- 单次 evidence 输入上限 8k tokens，输出上限 800 tokens。
- 付费 Oracle 默认 0 次，必须用户配置。

### ~~DRF-60：Supervisor 指导回注与 Worker 继续执行~~ ✅ 已完成

优先级：`P0/P1`。

目标闭环：

```text
Worker 失败
 -> EvidenceBundle
 -> SupervisorAdvice
 -> schema 校验
 -> 记录 checkpoint/telemetry
 -> 注入 Worker 可变上下文
 -> Worker 根据 nextActions 继续
 -> 验证
```

规则：

- Advice 注入必须带来源、时间、failure/evidence hash，防止旧建议覆盖新状态。
- Worker 必须复述选择的 nextAction 后再执行，便于审计。
- Advice 不授予额外权限，不绕过 BranchBudget；需要例外时请求用户，而不是自动 bypass。
- 若 Advice `requiresUser=true`、连续两次无进展、免费池耗尽或达到运行预算，保存 checkpoint 并请求用户。
- Supervisor 本身失败不应污染 Worker 对话，只记录简短状态。

关闭条件：

- 模拟 Worker 连续失败后，Supervisor 只给指导，Worker 继续调用已有工具完成任务。
- Supervisor 不可用时任务可保存、降级和继续，不崩溃。
- crash/restart 后不重复询问同一 evidence hash。

### ~~DRF-70：两阶段工具路由与 free/forced 模式~~ ✅ 已完成

优先级：`P2`，依赖完整闭环稳定。

直接复制并适配：

- SmallCode `src/tools/two_stage_router.js`
- iceCoder `src/harness/supervisor/mode-decision-engine.ts`

实施：

1. 先做确定性工具类别过滤；不要为选类别额外调用远程模型。
2. 对 <=16k 或 tool schema 预算超限的小模型启用两阶段路由。
3. MCP 动态工具按 category metadata 归类；未知工具进入 `full` fallback。
4. free 起步；出现 tool failure、large diff、multi-write、checkpoint resumed、verification failure 后进入 forced。
5. forced 退出必须满足无 pending verification、无 recovery pending、稳定轮次达到阈值。

暂不引入完整 TaskGraph 和 L1/L2 takeover。只有 benchmark 证明 TaskLedger 不足时再新建任务。

### ~~DRF-80：Benchmark、overnight 模式与发布门禁~~ ✅ 已完成

优先级：`P1/P2`。

来源参考：

- SmallCode benchmark diff 和现有测试脚本。
- iceCoder `benchMark/tasks/`、长任务报告和 supervisor 场景测试。
- Deepreef 现有 `packages/core/__tests__/benchmark.test.ts`、e2e 和 runtime logger。

建立固定矩阵：

| 维度 | 最少覆盖 |
|---|---|
| Worker | 本地 8B、14B/20B、远程中模型 |
| Harness | baseline、local-small-strict、supervisor-guided |
| 任务 | 单文件修复、多文件重构、失败测试诊断、长命令、畸形 tool call、恢复 |
| 指标 | 完成率、验证通过率、工具失败率、循环次数、Supervisor 次数、免费池可用率、token、耗时 |

必须证明：

- supervisor-guided 相比同一小模型 baseline 提高完成率。
- Supervisor 主要提供指导而不是替代 Worker 执行。
- 免费池不可用时不丢任务状态。
- 8 小时模拟长跑无无限循环、无后台进程泄漏、无 checkpoint 损坏。
- 默认配置不会意外调用付费模型。

---

## 5. 旧任务映射与保留事项

旧 TODO 中的任务按下表并入融合主线，后续不要重复实现：

| 旧任务 | 新任务 |
|---|---|
| `IC-10` BranchBudget | `DRF-30` |
| `IC-20` Runtime checkpoint v2 | `DRF-30` |
| `IC-30` Shell 双轨 | `DRF-32` |
| `IC-40` 参数 normalize/salvage | `DRF-31` |
| `IC-50` Runtime telemetry | 并入 `DRF-30/50/80`，复用现有 RuntimeLogger |
| `IC-60` TaskState/Verification Gate | `DRF-40` |
| `IC-70` 文件长期记忆 | 暂缓；Deepreef 已有 memory 专项，不从 iceCoder 搬 |

仍需独立收尾：

### ~~FG-60-R：best-effort 日志收尾~~ ✅ 已完成

优先级：`P2`。

- 将 `AsyncSessionWriter.getStatus()` 接入 `/status` 或 engine status。
- 为临时文件清理失败补低噪音日志，不覆盖原始错误。
- runtime logger 清理失败只记录 debug。

### ~~CTX-70：Context 文档和人工验收~~ ✅ 文档已完成（人工验收待项目负责人）

优先级：`P1`。

- README 增加 `/context` 说明。
- 人工验收 trim/compact、summarizer fallback 和重启后配置。

### OS-12/13-R：macOS 与 Windows 原生体验验收

优先级：`P1`。

- CI 已覆盖自动化；仍需真实终端验证 PTY/ConPTY、中文路径、通知、剪贴板和进程树。

---

## 6. 需要项目负责人决定的策略

以下不是当前实现阻塞项，但进入对应阶段前需要确认：

1. **远程 Supervisor 隐私默认值**：建议默认关闭；首次启用时明确提示 evidence 可能包含错误日志、路径和代码片段。
2. **付费 Oracle**：建议默认禁用，配置后仍需每次或每 session 确认。
3. **Worker 默认模型**：建议不硬编码具体本地模型；通过 `worker.local` target 和 profile 自动匹配。
4. **Supervisor 是否允许读取少量文件片段**：首版建议只接收 Worker 构建的 bounded evidence，不单独读仓库。
5. **达到预算后的行为**：建议保存 checkpoint 后暂停并请求用户，不在无人监督时无限重试。

在项目负责人未决定时，按上述“建议”实现保守默认值。

---

## 7. 明确暂缓

除非 benchmark 或用户明确要求，不要顺手实现：

- 完整 iceCoder TaskGraph。
- L1/L2 Supervisor takeover/handoff 和自动权限提升。
- Supervisor 直接执行工具或直接修改文件。
- 自动调用付费模型。
- 免费接口并行竞速。
- 整仓复制 iceCoder 或 SmallCode。
- 替换 Deepreef Context、Session、MCP、memory 或 TUI 架构；权限只能按 `PERM-10` 在现有 PermissionEngine/StreamingToolExecutor 接入点上升级。
- 为每个模型写大段独立 system prompt；优先用 profile 和 runtime policy。
- 动态 bash 并发判断、Python Kernel、Web/IDE 多前端、完整 OAuth MCP。

---

## 8. 当前下一步

> **状态摘要（2026-06-12）**：融合主线 `RM-10` → `DRF-80` 全部代码落地；收尾项 `FG-60-R` 完成、`CTX-70` 文档完成。测试基线 `1406 pass / 0 fail / 18 skip`（100 文件）。

✅ **融合主线** `RM-10` → `DRF-80`、**收尾项** `FG-60-R` / `CTX-70`（文档）均已代码落地。

唯一待办（需人工，非代码任务）：

```text
OS-12/13-R：macOS 与 Windows 原生体验验收
  - 真实终端验证 PTY/ConPTY、中文路径、通知、剪贴板、进程树
  - CI 自动化已覆盖，此项不能由 Agent 代劳
```

可选后续（不在当前 TODO 阻塞项）：

- `CTX-70` 人工验收：长会话 trim/compact、summarizer fallback、重启后配置持久化
- Supervisor 真实 smoke test：`DEEPREEF_SUPERVISOR_SMOKE=1` 验证免费池候选
- StepFun 3.5 通过 smoke 后再启用 `supervisor.stepfun` 候选
