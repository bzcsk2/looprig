# Deepicode Context 验收交接指南

最后更新：2026-06-03

本文只保留后续 Agent 仍需要执行的专项指导。已完成能力以 [DONE.md](DONE.md) 为准；待办入口以 [TODO.md](TODO.md) 为准。

当前只剩一个专项：`CTX-70` 文档和验收。

---

## 1. 当前事实

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

## 2. 不要重做的内容

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
   - 在 `README.md` 或 `TEST.md` 增加 `/context` 使用说明。
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

## 4. 本轮修复记录

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
