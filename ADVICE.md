# Deepicode 后续开发建议

最后更新：2026-06-04

本文只保留后续 Agent 仍需要执行的专项指导。已完成能力以 [DONE.md](DONE.md) 为准；待办入口以 [TODO.md](TODO.md) 为准；CI 与平台兼容性排查按 [CI-Compatibility-Fix-Guide.md](CI-Compatibility-Fix-Guide.md) 执行。

当前包含两个专项：

- `CTX-70`：Context 文档和验收。
- `FG-*`：基于 `Find_ground_Report.md` 的隐性兜底治理剩余项。

---

## 1. Context 当前事实

- `ContextPolicy`、`ContextPolicyStore`、summary 区域、`ContextSummarizer` 接口、engine 自动触发、真实 `LLMSummarizer` 都已经实现。
- `/context` 菜单已经实现并接入真实 engine policy：
  - `trim / compact` 切换。
  - `triggerRatio` / `targetRatio` 调整。
  - 当前 context 用量显示。
  - `Run now` 立即触发 reduction。
- `compact` 是用户界面名称；engine 内部会把 `compact` 映射到底层 compress/reduction 流程。
- 策略持久化文件是 `.deepicode/context.json`，不要合并进主配置。
- 本轮已修复 reset 后 `/` 菜单恢复不完整导致的类型错误和菜单交互错误。

---

## 2. Context 不要重做的内容

后续 Agent 不要重写以下内容：

- 不要重写 `ContextManager` 的三段式结构：`ImmutablePrefix + AppendOnlyLog + VolatileScratch`。
- 不要把 `/context` 菜单改成全屏。
- 不要把 compact 逻辑写进 TUI。
- 不要把 summarizer 做成普通工具。
- 不要覆盖历史 JSONL 原始消息。
- 不要把动态 MCP schema 或 plugin schema 混进 context prefix。

如果发现这些能力“不工作”，先写最小复现测试，再修具体 bug，不要按新方案推倒重来。

---

## 3. CTX-70：文档和验收

优先级：`P1`

目标：

- 把 Context 压缩专项从“代码完成”推进到“可交付验收”。
- 确认 `70% -> 30%` 的 trim 和 compact 在真实 TUI/CLI 场景中都能工作。
- 把验收结果写入 `DONE.md`，把仍需人工或平台环境验证的内容留在 `TODO.md`。

执行步骤：

1. 阅读当前实现：
   - `packages/core/src/context/policy.ts`
   - `packages/core/src/context/policy-store.ts`
   - `packages/core/src/context/summary.ts`
   - `packages/core/src/context/summarizer.ts`
   - `packages/core/src/context/manager.ts`
   - `packages/core/src/engine.ts`
   - `packages/tui/src/ContextModal.tsx`
   - `packages/tui/src/App.tsx`

2. 补充用户文档：
   - 在 `README.md` 增加 `/context` 使用说明。
   - 说明 `trim` 是机械裁剪。
   - 说明 `compact` 会调用模型生成 summary，失败会 fallback 到 trim。
   - 说明默认策略是 `70% -> 30%`。

3. 自动化验证：
   - 运行 context 相关目标测试。
   - 运行 typecheck。
   - 运行全量测试前确认没有外部服务依赖或已 mock。

建议命令：

```bash
bun test packages/core/__tests__/context-policy.test.ts
bun test packages/core/__tests__/context-summary.test.ts
bun test packages/core/__tests__/engine-context-policy.test.ts
bun test packages/core/__tests__/context-summarizer.test.ts
bun test packages/tui/__tests__/commands.test.ts
bun run typecheck
```

4. 人工验收：
   - 启动 TUI。
   - 输入 `/context`。
   - 选择 `trim`，设置 `70% -> 30%`，执行 `Run now`。
   - 用长会话把上下文推到 trigger 附近，确认 reduction 后接近 target。
   - 切换 `compact`，重复验证，确认 summary 出现在上下文中。
   - 模拟 summarizer 失败，确认 fallback trim，不中断用户提交。
   - 退出并重启，确认 `.deepicode/context.json` 策略仍然生效。

关闭条件：

- 上述目标测试通过。
- `bun run typecheck` 通过。
- 人工验收结果写入 `DONE.md`。
- `TODO.md` 中删除 `CTX-70` 或只保留明确无法自动化的人工验收项。

---

## 4. Find_ground_Report.md 审查结论

我对 `Find_ground_Report.md` 的结论是：**方向有价值，但严重级别和部分推论偏激，不能原样作为开发任务执行。**

报告客观指出了一个真实问题：项目中存在多处“兜底成功”路径，调用方或用户不一定能感知发生了降级、跳过或 best-effort 失败。这会降低可调试性，也会制造测试假阳性。

但报告有三类过度判断：

1. 把合理的 best-effort 行为直接升级为 P0/P1。
   - `SessionLoader.read()` 容忍尾行损坏、`AsyncSessionWriter` 不阻塞主流程、MCP 单 server 失败不阻塞其他 server，这些是明确的产品取舍。
   - 不能简单改成 fail-fast，否则会破坏 session recovery、CLI 启动和 MCP 部分可用性。

2. 忽略已有日志或观察机制。
   - `AsyncSessionWriter.append_error` 已有 debug 日志。
   - `HookManager` 已有 `setErrorObserver()`，engine 已接到 `hook.error`。
   - `McpHost.connect()` 已记录 `mcp.server.connect.error`，只是 `cli.ts` 的 load promise 对用户侧没有反馈。

3. 建议的 API 破坏面过大。
   - 直接把 `TokenizerPool.estimate(): Promise<number>` 改成 `{ value, source }` 会波及 `ContextManager`、status、policy、tests 和所有预算调用点。收益存在，但不是第一步。
   - 直接把 `edit` fuzzy fallback 默认关闭，会改变工具成功率和模型编辑体验，应先做显式告警，再评估 strict mode。

因此后续处理原则是：

- 不消灭所有 fallback。
- 不把 best-effort 全部改成 throw。
- 只治理“调用方无法感知且可能产生错误行为”的兜底。
- 对允许保留的兜底补日志、状态、测试和文档。

---

## 5. FG 专项状态

本轮已完成：

- `FG-20`：TokenizerPool fallback 可感知化。
- `FG-30`：SessionLoader detailed read。
- `FG-40`：工具参数 JSON 解析失败 fail-fast。
- `FG-50`：edit fuzzy fallback 显式 warning。
- `FG-70`：MCP load summary 和 CLI 用户可见提示。

仍需后续处理：

- `FG-10`：形成正式兜底行为分类文档或代码规范。
- `FG-60`：临时文件清理和低风险 best-effort 路径的日志收尾。

---

## 6. FG 剩余实施建议

### FG-10：兜底行为分类和可观测性基线

优先级：`P1`

目标：

- 建立项目内统一规则：哪些 fallback 允许，哪些必须 fail-fast，哪些必须返回 warning。
- 先补观测，不先做破坏性 API 改动。

剩余实施范围：

- `packages/core/src/result-persistence.ts`
- `packages/core/src/runtime-logger.ts`
- `packages/tools/src/hash-edit.ts`
- `packages/tools/src/notebook-edit.ts`

建议实现：

1. 新增一份轻量内部文档或代码注释规范，分类为：
   - `recoverable_fallback`：允许继续，但必须可观测。
   - `best_effort_persistence`：不阻塞主流程，但必须记录失败和计数。
   - `invalid_model_output`：不能继续执行真实工具，必须返回 tool error。
   - `optional_capability_missing`：例如 MCP resources/prompts，可 debug 记录即可。

2. RuntimeLogger 事件命名保持统一，不记录正文和敏感参数。以下事件已在代码路径中使用或预留：
   - `fallback.tokenizer`：已实现。
   - `mcp.load.warning`：已实现。
   - `tool.args.invalid_json`：已实现。
   - `edit.fuzzy_fallback`：结果 warning 已实现，runtime log 可后续补。
   - `session.writer.flush_error`：writer status 已实现，事件名可后续补。

3. 不要把所有 `.catch(() => {})` 机械替换成 warn。
   - 测试清理的 `rm(...).catch(() => {})` 不需要产品日志。
   - `reader.cancel()` / `resp.body.cancel()` 失败属于资源释放低风险路径，可 debug 或保持不报。
   - `unlink(tmpPath)` 清理临时文件失败要记录，但不能覆盖原始编辑错误。

验收：

```bash
bun run typecheck
bun test packages/core/__tests__/session.test.ts
bun test packages/mcp/__tests__/mcp-host.test.ts
```

### FG-50 后续：评估 edit strict mode

优先级：`P3`

当前已经完成第一步：fuzzy fallback 保留原行为，并在返回 JSON 中增加 `warning: "exact_match_failed_used_fuzzy"`。

后续如需 strict mode：

- 工具参数新增 `fuzzy_match?: boolean`。
- 默认值是否改为 `false` 需要单独评估，不要在第一版改。
- 如果引入 strict mode，system prompt / tool description 必须同步说明。

### FG-60：best-effort 持久化和临时文件清理告警

优先级：`P2`

范围：

- `AsyncSessionWriter`
- `hash-edit.ts`
- `notebook-edit.ts`
- `runtime-logger.ts`
- `result-persistence.ts`

建议：

- `AsyncSessionWriter.getStatus()` 已实现；后续可把该状态接入 `/status`。
- flush 失败保留 best-effort，不抛到 submit 主流程；后续可补 `session.writer.flush_error` 事件名。
- `chmod(tmpPath)` 失败：记录 warning，继续执行。
- `unlink(tmpPath)` 失败：记录 warning，不能覆盖原始错误。
- runtime logger 清理旧日志失败可 debug，不需要 P1/P2。

---

## 7. 对 Find_ground_Report.md 的逐项采纳状态

| 报告项 | 结论 | 调整后优先级 | 处理意见 |
|--------|------|--------------|----------|
| TokenizerPool fallback | 基本成立，但不应 P0 阻断发布 | 已完成 | 保留 fallback，已补 diagnostics/log，并修 pending task 用空消息估算的问题 |
| SessionLoader `[]` | 成立，但不能直接破坏旧 API | 已完成 | 已新增 detailed API，旧 API 保持兼容 |
| AsyncSessionWriter catch | 部分成立 | 部分完成 | 已有 debug append_error，已补 status/lastError；事件接入可后续补 |
| Hook event catch | 报告不准确 | P3 | HookManager 已有 error observer；最多补测试确认 |
| DeepSeek body missing | 报告过度 | P3 | 已 yield error；重点是 loop 是否消费 error，不是 client fail-fast |
| StreamingToolExecutor args `{}` | 成立且重要 | 已完成 | 已改为 fail-fast 并回写 tool error |
| hash-edit chmod/unlink | 部分成立，严重级别偏高 | P2 | 补日志，不改变主流程 |
| edit fuzzy fallback | 成立但不宜马上关闭 | 部分完成 | 已补 warning；runtime log/strict mode 后续评估 |
| grep rg->grep fallback | 合理兼容 | P3 | 可 debug 记录，不是 bug |
| MCP connectAll | 部分成立 | 已完成 | 保持部分可用，已补 summary/status 和 CLI 提示 |
| 测试 cleanup catch | 不采纳 | - | 测试清理 `rm(...force).catch` 不是产品假阳性核心问题 |

---

## 8. 本轮修复记录

本轮已完成但尚未提交的恢复修复：

- `/status`、`/context` 加回 slash command 解析、命令注册和 i18n 文案。
- `CommandAutocomplete`：Enter 直接执行命令，Tab 只补全到输入框。
- `DeepiPromptInput`：支持外部输入历史、`injectedText`、`suppressSubmit`，避免 autocomplete 与输入框抢 Enter/↑↓。
- `SkillModal`：恢复 52 个 skill 列表式二级菜单，Space 启用/禁用，Enter 插入 `#skill `。
- `ContextModal`：恢复真实 policy 菜单，支持 `trim/compact`、比例调整和 `Run now`。
- Core 类型缺口：补回 `AppendOnlyLog.replaceAll()`，补齐 `LoopOptions.config.provider?`。
- Plugin runtime 类型缺口：统一记录 config/load/tool 三类 plugin error。

本轮已实际运行：

```bash
bun run typecheck
bun test packages/tui
```

完整 `bun test` 本轮按用户要求中断，不把本轮完整测试作为已完成结论。
