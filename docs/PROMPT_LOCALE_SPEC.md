# Prompt Locale Switching Spec

目标：让 LoopRig 的模型侧 prompt 跟随 `/lang` 的中英文选择切换。

当前问题：

- `/lang` 只切换 TUI 文案，不切换发给模型的 system prompt、role prompt、eval prompt、workflow prompt。
- `packages/core/src/system-prompt.ts` 仍使用中文且写着 `deepreef`，与当前项目名 LoopRig 不一致。
- 内置 Worker/Supervisor/subagent prompt 大多是英文，eval native fixture taskPrompt 大多是中文，导致同一轮运行中 UI、system prompt、任务 prompt 混用语言。
- 语言状态在 `packages/tui/src/i18n/*`，core 层不知道当前 locale。

本 spec 是给后续 agent 执行的开发计划。实施时必须先读相关源码，不要只做字符串替换。

## Desired Behavior

用户选择：

```text
/lang -> English
```

之后所有 LoopRig 自己构造并发给模型的 prompt 必须是英文：

- base system prompt
- Worker/Supervisor role prompt
- loop/subagent/eval mode prompt
- workflow coordinator prompt
- verification gate prompt
- task ledger scratch prompt
- supervisor advice request / scratch prompt
- eval worker/supervisor wrapper prompt
- scoring/benchmark prompt

用户选择：

```text
/lang -> 中文
```

之后上述 prompt 必须是中文。

重要边界：

- 用户原始输入不翻译。
- 文件内容、工具输出、日志内容不翻译。
- 外部 benchmark 的原始任务说明不强行翻译，例如 SWE-bench、Terminal-Bench 的 upstream task text。否则会破坏 benchmark 客观性。
- 自定义 plugin、content pack、用户自定义 agent 的 prompt 不强行翻译。LoopRig 只能控制内置 prompt。
- JSON schema key 不翻译，例如 `dimensions`, `taskCompletion`, `verification`，否则会破坏解析。
- 命令名、工具名、文件路径、代码标识符不翻译。

最终规则：

```text
LoopRig-authored instructions -> follow /lang
User/source/task payload      -> preserve original language
Machine-readable schema       -> preserve keys
```

## P0 Architecture

新增 core 级 prompt locale 模块：

```text
packages/core/src/prompt-locale.ts
```

建议接口：

```ts
export type PromptLocale = "zh-CN" | "en"

export function normalizePromptLocale(value: unknown): PromptLocale
export function setPromptLocale(locale: PromptLocale): void
export function getPromptLocale(): PromptLocale
export function isChinesePromptLocale(locale?: PromptLocale): boolean
export function loadPromptLocaleFromDisk(cwd?: string): PromptLocale | null
export function savePromptLocaleToDisk(locale: PromptLocale, cwd?: string): void
```

持久化位置继续使用：

```text
.deepreef/lang.json
```

这样 TUI 和 core 共享同一个语言状态，不再让 `packages/tui/src/i18n/persist.ts` 成为唯一来源。

兼容策略：

- `packages/tui/src/i18n/persist.ts` 可以改为调用 core 的 load/save，也可以保留 thin wrapper。
- 默认 locale 维持当前行为：`zh-CN`。
- `PromptLocale` 不要依赖 React/TUI 包，必须能在 core、CLI、tests 中使用。

## P0 Core Prompt Builders

### 1. Base System Prompt

修改：

```text
packages/core/src/system-prompt.ts
```

要求：

- `buildSystemPrompt(cwd, options)` 增加 `locale?: PromptLocale`。
- 未传 locale 时使用 `getPromptLocale()`。
- 提供中英文两个完整模板。
- 中文模板产品名必须改为 `LoopRig`，不要继续写 `deepreef`。
- 英文模板必须自然，不要机械翻译。

示例接口：

```ts
export function buildSystemPrompt(
  cwd: string,
  options?: {
    osPlatform?: string
    shellBackend?: string
    locale?: PromptLocale
  },
): string
```

验收：

- `buildSystemPrompt(".", { locale: "en" })` 包含 `You are LoopRig`，不包含 `你是 deepreef`。
- `buildSystemPrompt(".", { locale: "zh-CN" })` 包含 `你是 LoopRig`。

### 2. Built-in Agent Prompts

修改：

```text
packages/core/src/agent.ts
packages/core/src/agent-registry.ts
packages/core/src/main-mode.ts
```

要求：

- 内置 `worker` / `supervisor` 的 system prompt 双语。
- `agentConfigFor()` 必须按当前 locale 返回内置 prompt。
- 保持自定义 agent 兼容：如果 plugin agent 只有 `systemPrompt`，原样使用。

建议结构：

```ts
interface AgentDefinition {
  name: string
  label: string
  systemPrompt?: string
  systemPromptByLocale?: Partial<Record<PromptLocale, string>>
}

export function getAgentSystemPrompt(def: AgentDefinition, locale = getPromptLocale()): string | undefined
```

验收：

- `setPromptLocale("en"); agentConfigFor("worker").systemPrompt` 是英文。
- `setPromptLocale("zh-CN"); agentConfigFor("worker").systemPrompt` 是中文。
- 自定义 agent 不丢失原始 `systemPrompt`。

### 3. Subagent Prompts

修改：

```text
packages/core/src/subagent/definition.ts
packages/core/src/subagent/run.ts
packages/core/src/engine.ts
```

要求：

- 内置 subagent `general-purpose`、`Explore`、`Plan` 提供双语 prompt。
- `SubagentRunner.spawnAndRun()` 和 `ReasonixEngine.spawnSubagent()` 使用 locale 后的 prompt。
- 自定义 subagent prompt 原样保留。

验收：

- 中文 locale 下派生 subagent 的 system prompt 是中文。
- 英文 locale 下派生 subagent 的 system prompt 是英文。

## P0 Runtime Locale Sync

### 1. CLI/TUI Startup

修改：

```text
packages/cli/src/tui.ts
```

要求：

- 启动时读取 `.deepreef/lang.json`。
- 调用 `setPromptLocale(locale)`。
- 构造 `baseSystemPrompt` 时传入 locale。
- supervisor engine 使用同一个 locale 的 base prompt。

当前代码中类似：

```ts
let baseSystemPrompt = buildSystemPrompt(process.cwd(), {
  osPlatform: platform,
  shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
})
```

应改为：

```ts
const promptLocale = loadPromptLocaleFromDisk(process.cwd()) ?? "zh-CN"
setPromptLocale(promptLocale)
let baseSystemPrompt = buildSystemPrompt(process.cwd(), {
  osPlatform: platform,
  shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
  locale: promptLocale,
})
```

### 2. `/lang` Runtime Switch

修改：

```text
packages/tui/src/App.tsx
packages/tui/src/i18n/index.ts
packages/tui/src/i18n/persist.ts
```

要求：

- `/lang` 选择后同时更新：
  - TUI locale
  - core prompt locale
  - `.deepreef/lang.json`
  - main engine base system prompt
  - supervisor engine base system prompt
- 不要求重写已有历史消息；从下一次 submit 开始生效。

推荐实现：

- 在 `AppProps` 增加回调：

```ts
onPromptLocaleChange?: (locale: PromptLocale) => void
```

- `packages/cli/src/tui.ts` 持有一个 `rebuildBaseSystemPrompt(locale)` 函数，保留 plugin rules/memory context 追加内容。
- `/lang` 回调里调用 `onPromptLocaleChange(nextLocale)`。

不要在 `App.tsx` 里临时猜测 shell/platform 重建 system prompt，因为 CLI 已经解析了真实 shell backend。

验收：

- 启动中文：首次请求 system prompt 为中文。
- `/lang -> English` 后，下一次请求 system prompt 为英文。
- `/lang -> 中文` 后，下一次请求 system prompt 为中文。
- supervisor 独立 engine 也同步切换。

## P0 ReasonixEngine Prompt Layers

修改：

```text
packages/core/src/engine.ts
```

必须双语化的位置：

- `buildSupervisorLoopModePrompt()`
- subagent mode prompt
- loop worker mode prompt
- `buildActiveSkillsPrompt()`
- TaskLedger scratch 注入调用
- child engine/subagent 创建时的 localized systemPrompt

建议：

- 在 `ReasonixEngine` 增加：

```ts
setPromptLocale(locale: PromptLocale): void
getPromptLocale(): PromptLocale
```

- `submit()` 内每次构造 modeLayer 时使用 `this.promptLocale` 或 `getPromptLocale()`。
- `agentConfigFor(agentName)` 要拿到当前 locale。

验收：

- 英文 locale 下 `mode === "loop"` 的 Worker/Supervisor modeLayer 为英文。
- 中文 locale 下对应 modeLayer 为中文。
- `Enabled Skills` 段落在中文 locale 下改为中文标题和说明。

## P0 Governance And Scratch Prompts

这些 prompt 会直接注入模型上下文，必须双语。

修改：

```text
packages/core/src/task-ledger.ts
packages/core/src/governance/verification-gate.ts
packages/core/src/governance/branch-budget.ts
packages/core/src/goal/steering.ts
packages/core/src/loop-helpers.ts
packages/core/src/supervisor/guided-loop.ts
packages/core/src/workflow-coordinator/coordinator.ts
```

### Required Changes

`task-ledger.ts`

- `formatLedgerForContext()`
- `formatPlanForContext()`
- `planRequestInstruction()`

`verification-gate.ts`

- `buildVerificationGatePrompt()`
- gate limit message

`branch-budget.ts`

- `buildRecoverySignal()`

`goal/steering.ts`

- `buildContinuationPrompt()`
- `buildBudgetLimitPrompt()`
- `buildUsageLimitPrompt()`

`loop-helpers.ts`

- pending instruction status can remain machine-friendly, but injected user-facing prompt must follow locale if added later.

`supervisor/guided-loop.ts`

- `buildSupervisorRequestMessages()`
- `formatSupervisorAdviceForScratch()`

`workflow-coordinator/coordinator.ts`

- supervisor analyse prompt
- worker do prompt
- worker report/check prompt
- resume/previous round prompt
- final completion/block prompts if model-facing

Implementation style:

- Add optional `locale?: PromptLocale` params where functions are pure builders.
- Default to `getPromptLocale()` to avoid large call-site churn.
- Do not translate JSON keys in expected JSON response schemas.

验收：

- `setPromptLocale("en")` 后 injected scratch 不出现中文框架词，例如 `当前策略已达到`、`你的任务是`。
- `setPromptLocale("zh-CN")` 后 injected scratch 不出现 English framework sentences like `Continue working toward the current goal` except schema keys/tool names.

## P0 Eval And Scoring Prompts

修改：

```text
packages/core/src/eval/runner.ts
packages/core/src/scoring/eval-prompts.ts
packages/core/src/scoring/eval-runner.ts
```

要求：

- `FixedEvalOptions` 增加 `locale?: PromptLocale`。
- `runFixedEval()` 默认使用 `getPromptLocale()`。
- `buildWorkerPrompt()` 和 `buildSupervisorPrompt()` wrapper 双语。
- `buildWorkerEvalPrompt()` 和 `buildSupervisorEvalPrompt()` 增加 locale option。
- JSON schema key 不翻译。
- `manifest.taskPrompt` 保持原文插入，不强行翻译。

示例：

```ts
export interface FixedEvalOptions {
  locale?: PromptLocale
}
```

验收：

- `/lang -> English` 后运行 `/cases` eval，worker wrapper 为英文。
- `/lang -> 中文` 后运行 `/cases` eval，worker wrapper 为中文。
- SWE-bench / Terminal-Bench 原始任务 text 保持来源语言。
- Native fixture 如果要完全双语，应新增 `taskPromptByLocale`，不要用自动翻译。

## P1 Native Eval Fixture Dual Language

当前：

```text
packages/core/src/eval/fixtures/index.ts
```

许多 native fixture 的 `taskPrompt` 是中文。

如果用户要求“native case 也随 /lang 改变”，实现方式：

```ts
taskPromptByLocale?: Partial<Record<PromptLocale, string>>
```

规则：

- native fixture 可以维护人工双语版本。
- external benchmark 不维护翻译版，除非 upstream 本身提供。
- loader 输出 `taskPrompt` 时按 locale resolve，或在 prompt builder 中 resolve。

P1 验收：

- native fixture 在英文 locale 下显示英文任务说明。
- 中文 locale 下显示中文任务说明。
- case id、verify commands、expectedVerification 不因语言变化而改变。

## P1 Tests

新增或更新测试：

```text
packages/core/__tests__/prompt-locale.test.ts
packages/core/__tests__/eval-prompt-locale.test.ts
packages/tui/__tests__/i18n.test.ts
```

必须覆盖：

- `setPromptLocale/getPromptLocale`。
- `buildSystemPrompt()` 中英文切换。
- `agentConfigFor("worker")` 中英文切换。
- `buildVerificationGatePrompt()` 中英文切换。
- `buildWorkerPrompt()` / `buildSupervisorPrompt()` eval wrapper 中英文切换。
- TUI `setLocale()` 或 `/lang` 相关逻辑同步 core prompt locale。

建议增加 fake client 集成测试：

- 创建 `ReasonixEngine`，设置 locale 为 `en`。
- fake `ChatClient` 捕获 `messages[0].content`。
- 调用 `engine.submit("test", undefined, "worker", "loop")`。
- 断言 system prompt 和 loop mode prompt 为英文。
- 切换到 `zh-CN` 后再次 submit，断言为中文。

## P2 Prompt Catalog Cleanup

后续可以把内置 prompt 收敛到统一目录：

```text
packages/core/src/prompts/
  locale.ts
  system.ts
  agents.ts
  workflow.ts
  eval.ts
  governance.ts
```

本轮不强制重构。优先完成行为一致性，不要为了目录整理扩大改动面。

## Non-Goals

本任务不要做：

- 不要引入机器翻译服务。
- 不要翻译用户输入。
- 不要翻译代码、日志、工具输出、文件内容。
- 不要翻译 JSON schema key。
- 不要改模型选择、provider、cache 逻辑。
- 不要改 eval scoring 语义。
- 不要把 language locale 和 model locale 分成两个用户设置；本轮 `/lang` 即唯一来源。

## Acceptance Checklist

手动验收：

1. 删除或修改 `.deepreef/lang.json` 为 `{"lang":"zh-CN"}`，启动 LoopRig。
2. 发送一个普通任务，用 fake/log 或 debug 方式确认 system prompt 是中文，并且产品名是 LoopRig。
3. `/lang -> English`。
4. 再发送普通任务，确认 system prompt、Worker role prompt、loop/subagent mode prompt 是英文。
5. 进入 `/eval`，用 `/cases` 启动一个 sandbox native case，确认 eval wrapper 是英文。
6. `/lang -> 中文`。
7. 再运行同类任务，确认 wrapper 和 runtime injected prompts 回到中文。
8. 确认已有 session 历史不被重写，只影响后续请求。

自动验收：

```bash
bun run typecheck
bun test packages/core/__tests__/prompt-locale.test.ts
bun test packages/core/__tests__/eval-prompt-locale.test.ts
bun test packages/tui/__tests__/i18n.test.ts
bun test packages/core/__tests__/ packages/tui/__tests__/
```

最低完成标准：

- P0 全部完成。
- Typecheck 通过。
- core+tui 相关测试通过。
- 英文 locale 下不再出现 LoopRig 自己构造的中文 instruction。
- 中文 locale 下不再出现 LoopRig 自己构造的英文 instruction。

允许残留：

- plugin/custom agent prompt 保持原文。
- external benchmark 原始题面保持原文。
- JSON schema key、tool name、file path、command 保持英文/原文。

