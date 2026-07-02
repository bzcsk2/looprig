# Prompt Locale Repair Spec

本文件用于指导后续 agent 修复 `docs/PROMPT_LOCALE_SPEC.md` 实现后的遗留问题。

当前实现大体完成了 prompt locale 的基础结构，但还不能按“全部修复”验收。后续 agent 必须只修本文件列出的缺陷，不要顺手重构无关模块。

## Agent Rules

- 先阅读 `docs/PROMPT_LOCALE_SPEC.md`，再阅读本文件列出的目标文件。
- 不要修改用户输入、工具输出、日志、外部 benchmark 原始题面。
- 不要翻译 JSON schema key、工具名、命令名、文件路径、代码标识符。
- 不要改模型选择、provider、cache、eval scoring 语义。
- 不要提交 `.covalo/runs/**` 运行产物。
- 不要把已有脏工作树当成自己的修改。修复前先用 `git status --short` 区分现有变更。

## Priority

必须按下面顺序修：

1. P0 subagent locale 主路径未生效。
2. P0 `/lang` 热切换丢失追加 system prompt 上下文。
3. P0 core 默认 locale 与 spec 不一致。
4. P1 补真正的 fake-client engine submit 集成测试。
5. P1/P2 清理 scoring prompt 中文分支中的英文框架词。
6. 提交范围清理：移除运行产物。

## Repair Pack A: ReasonixEngine Subagent Locale

### Problem

`docs/PROMPT_LOCALE_SPEC.md` 要求：

- `SubagentRunner.spawnAndRun()` 使用 locale 后的 prompt。
- `ReasonixEngine.spawnSubagent()` 使用 locale 后的 prompt。

`SubagentRunner.spawnAndRun()` 已经调用 `getSubagentSystemPrompt(def)`。

但 `ReasonixEngine.spawnSubagent()` 仍然使用 `def.systemPrompt`，因此中文 locale 下通过 `AgentTool` 派生的内置 subagent 仍会收到英文 system prompt。

### Target Files

- `packages/core/src/engine.ts`
- `packages/core/src/subagent/definition.ts`
- `packages/core/__tests__/prompt-locale-integration.test.ts` 或新增更合适的测试文件

### Required Fix

在 `packages/core/src/engine.ts` 中：

- 导入 `getSubagentSystemPrompt`。
- 在 `spawnSubagent()` 创建 `agentCfg` 时，把 `systemPrompt: def.systemPrompt` 改为 locale-aware 解析。
- 不要改变自定义 subagent 的 fallback 行为。自定义 definition 只有 `systemPrompt` 时必须原样保留。

期望行为：

- `setPromptLocale("zh-CN")` 后，`ReasonixEngine.spawnSubagent()` 使用内置 subagent 的中文 prompt。
- `setPromptLocale("en")` 后，使用英文 prompt。
- 未配置 locale-specific prompt 的自定义 subagent 继续使用原始 `systemPrompt`。

### Acceptance

新增或更新测试覆盖：

- `getSubagentSystemPrompt(BUILTIN_SUBAGENTS.general-purpose, "zh-CN")` 返回中文。
- `ReasonixEngine.spawnSubagent()` 实际 submit 的 child engine system prompt 在中文 locale 下包含中文子代理说明。
- 英文 locale 下仍包含英文说明。

优先写 engine-level 测试，不要只测 pure builder。

## Repair Pack B: Preserve System Prompt Add-ons During `/lang` Switch

### Problem

启动时 `packages/cli/src/tui.ts` 会在 base system prompt 后追加：

- plugin/content pack rules from `pluginRuntime.compileRules().systemPrompt`
- memory context from `mem::context`

但 `/lang` 回调中只重新调用 `buildSystemPrompt()`，然后直接 `engine.setSystemPrompt(newPrompt)`。这样一旦用户执行 `/lang`，worker 和 supervisor 的 system prompt 会丢掉 plugin rules 和 memory context。

这违反 `docs/PROMPT_LOCALE_SPEC.md` 中的要求：

```text
packages/cli/src/tui.ts 持有一个 rebuildBaseSystemPrompt(locale) 函数，保留 plugin rules/memory context 追加内容。
```

### Target Files

- `packages/cli/src/tui.ts`
- `packages/tui/src/App.tsx`
- related tests if a CLI/TUI test harness exists

### Required Fix

在 `packages/cli/src/tui.ts` 中整理 system prompt 状态：

- 维护 `basePromptLocale` 或当前 locale。
- 维护 base template 的重建函数，例如 `rebuildBaseSystemPrompt(locale)`.
- 维护追加段落，不要把追加内容直接混进不可重建的 `baseSystemPrompt` 字符串里。

建议状态结构：

```ts
let currentPromptLocale = promptLocale
let pluginRulesPrompt = ""
let memoryContextPrompt = ""

function rebuildBaseSystemPrompt(locale = currentPromptLocale): string {
  currentPromptLocale = locale
  return [
    buildSystemPrompt(process.cwd(), {
      osPlatform: platform,
      shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
      locale,
    }),
    pluginRulesPrompt,
    memoryContextPrompt,
  ].filter(Boolean).join("\n\n")
}
```

注意：

- `pluginReady` 完成后，只更新 `pluginRulesPrompt`，再 `engine.setSystemPrompt(rebuildBaseSystemPrompt())`。
- `memoryReady` 完成后，只更新 `memoryContextPrompt`，再 `engine.setSystemPrompt(rebuildBaseSystemPrompt())`。
- `/lang` 回调只切换 locale，并通过同一个 rebuild 函数重新设置 worker/supervisor prompt。
- 不要在 `App.tsx` 里猜测 shell/platform；真实值已经在 CLI 中解析。

### Acceptance

必须验证：

- 启动后包含 plugin rules 的 system prompt，在 `/lang -> English` 后仍包含 plugin rules。
- 启动后包含 memory context 的 system prompt，在 `/lang -> English` 后仍包含 memory context。
- `/lang -> 中文` 后仍保留这些追加段落。
- supervisor 独立 engine 同步更新。

如果没有现成 TUI 测试，可以抽出纯函数或小 helper，使上述拼接行为可测试。

## Repair Pack C: Core Default Locale

### Problem

`docs/PROMPT_LOCALE_SPEC.md` 明确要求默认 locale 维持 `zh-CN`。

当前 `packages/core/src/prompt-locale.ts` 中 `DEFAULT_LOCALE` 是 `"en"`。这会导致无 `.covalo/lang.json` 的非 TUI core 使用场景默认英文，违背 spec。

测试中的 `default locale is zh-CN` 被 `beforeEach(() => setPromptLocale("zh-CN"))` 掩盖，并没有真正验证模块默认值。

### Target Files

- `packages/core/src/prompt-locale.ts`
- `packages/core/__tests__/prompt-locale.test.ts`

### Required Fix

- 将 core 默认 locale 改为 `zh-CN`，除非产品决策明确变更 spec。
- `normalizePromptLocale(unknown)` 应返回默认 locale，因此未知值也应回到 `zh-CN`。
- 修改测试，避免 `beforeEach` 掩盖默认值。

### Test Requirements

测试必须能证明独立模块初始状态。

可选方式：

- 把默认值导出为只读常量并直接断言。
- 增加 `resetPromptLocaleForTests()`，仅测试使用。
- 在子进程中 import 模块并断言 `getPromptLocale()`。

不要写这种无效测试：

```ts
beforeEach(() => setPromptLocale("zh-CN"))
test("default locale is zh-CN", () => {
  expect(getPromptLocale()).toBe("zh-CN")
})
```

### Acceptance

- 独立进程中 import `getPromptLocale()` 返回 `zh-CN`。
- `normalizePromptLocale("fr")` 返回 `zh-CN`。
- TUI 仍然从 `.covalo/lang.json` 覆盖 locale。
- 现有英文预期测试通过必要的 `setPromptLocale("en")` 保持兼容。

## Repair Pack D: Real Fake-Client Integration Test

### Problem

`packages/core/__tests__/prompt-locale-integration.test.ts` 文件头写着：

```text
Uses a fake ChatClient that captures messages[0].content
```

但实际测试没有创建 fake `ChatClient`，也没有调用 `ReasonixEngine.submit()`，只是在测 builder。它不能证明 `/lang` 热切换后下一次 submit 的 system message 真的变更。

### Target Files

- `packages/core/__tests__/prompt-locale-integration.test.ts`
- `packages/core/src/engine.ts` if needed for testability only

### Required Fix

增加真正的 integration test：

- 创建 fake `ChatClient`，捕获传入模型的 messages。
- 创建 `ReasonixEngine`，使用 fake client。
- 设置 `setPromptLocale("en")`，设置英文 base system prompt。
- 调用 `engine.submit("test", undefined, "worker", "loop")`。
- 断言发送给 fake client 的 system prompt 包含英文 base prompt 和英文 loop mode prompt。
- 切换 `setPromptLocale("zh-CN")`，重新设置中文 base system prompt。
- 再次 submit，断言 system prompt 切到中文。

如果 `ReasonixEngine` 的 fake client 注入已有构造参数，直接使用；不要为了测试大改 engine API。

### Acceptance

测试必须覆盖真实调用链：

```text
setPromptLocale -> buildSystemPrompt/setSystemPrompt -> ReasonixEngine.submit -> fake client captured messages
```

测试不能只断言 pure builder 输出。

## Repair Pack E: Scoring Prompt Chinese Branch Cleanup

### Problem

`packages/core/src/scoring/eval-prompts.ts` 已经把部分中文分支改成中文，但仍存在 Covalo-authored 英文框架词。例如：

- `Repository`
- `Constraints`
- `Token budget`
- `Original Objective`

这些不是 JSON schema key，也不是用户 payload，属于 Covalo 自己构造的 prompt heading/instruction，中文 locale 下应为中文。

### Target Files

- `packages/core/src/scoring/eval-prompts.ts`
- `packages/core/__tests__/prompt-locale.test.ts` or a dedicated eval prompt locale test

### Required Fix

在中文分支中本地化所有 Covalo-authored headings/instructions。

不要翻译：

- `benchmarkCase.repository` 内容本身
- `benchmarkCase.prompt` / objective 内容本身
- JSON schema keys such as `summary`, `completedSteps`, `verification`, `dimensions`
- file paths, commands, tool names

### Acceptance

中文 locale 下：

- 不出现 `Repository`、`Constraints`、`Token budget`、`Original Objective` 这类英文框架词。
- JSON schema keys 仍保持英文。
- benchmark 原始内容仍原样插入。

英文 locale 下：

- 输出英文框架词。
- 不出现中文框架词。

## Repair Pack F: Native Eval Fixture Locale Scope

### Problem

只有部分 native fixture 增加了 `taskPromptByLocale.en`。`docs/PROMPT_LOCALE_SPEC.md` 把 native fixture 双语列为 P1，不一定阻塞 P0，但如果宣称 P1 完成，就必须覆盖所有 native fixture。

### Target Files

- `packages/core/src/eval/fixtures/index.ts`
- `packages/core/src/eval/runner.ts`
- `packages/core/src/eval/loader.ts`
- tests for native fixture prompt resolution

### Required Fix

如果本轮目标包含 P1：

- 给所有 native fixture 增加人工维护的 `taskPromptByLocale.en`。
- 保持 `expectedVerification`、verifier command、case id 不随语言变化。
- `resolveTaskPrompt()` 继续只按 locale 选择人工版本，不做机器翻译。

如果本轮只修 P0：

- 明确在最终说明中声明 native fixture 全量双语仍是 P1 残留。

### Acceptance

- 英文 locale 下 native fixtures 的 task prompt 是英文。
- 中文 locale 下 native fixtures 的 task prompt 是中文或原始中文。
- external benchmark 原始题面不被翻译。

## Repair Pack G: Commit Hygiene

### Problem

`3bd6155` 包含大量 `.covalo/runs/**` 运行产物。这些文件不是 prompt locale 实现，不能留在修复提交中。

### Required Fix

- 从提交范围中移除 `.covalo/runs/**`。
- 确认 `.gitignore` 是否应忽略 `.covalo/runs/` 或具体运行产物目录。
- 不要删除用户需要保留的本地运行数据，除非用户明确允许。提交清理应通过 staging 范围控制完成。

### Acceptance

修复提交中：

- 不包含 `.covalo/runs/**`。
- 只包含实现、测试和必要文档。

## Suggested Verification Commands

最小验证：

```bash
bun test packages/core/__tests__/prompt-locale.test.ts packages/core/__tests__/prompt-locale-integration.test.ts
bun -e "import { getPromptLocale, normalizePromptLocale } from './packages/core/src/prompt-locale.ts'; console.log({ defaultLocale: getPromptLocale(), unknown: normalizePromptLocale('fr') })"
```

类型检查：

```bash
bun run typecheck
```

如果 `bun run typecheck` 因无关脏工作树失败，必须在最终说明中写清楚：

- 失败文件。
- 该文件是否属于本次 prompt locale 修复。
- 是否能在干净工作树或隔离分支复现。

建议补充：

```bash
git diff --name-only --cached | grep '^.covalo/runs/' && echo "unexpected run artifacts"
```

## Done Criteria

后续 agent 只有同时满足以下条件，才能说修复完成：

- P0 A、B、C 全部完成。
- 真实 fake-client engine submit 集成测试覆盖 locale 切换。
- prompt-locale 相关测试通过。
- typecheck 通过，或明确证明失败来自无关预先存在变更。
- 提交范围不包含 `.covalo/runs/**`。
- 最终说明不再声称未覆盖的 P1 项已完成。
