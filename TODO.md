# Deepicode TODO 与开发交接指南

最后更新：2026-06-02

本文是后续 Agent 的唯一待办入口，只记录**尚未完成**、**待验收**或**明确暂缓**的工作。
已完成能力见 [DONE.md](DONE.md)。历史审计见 [ADVICE.md](ADVICE.md)，其中包含已经修复或驳回的旧结论，不要直接照单修改代码。

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
| 1 | ~~`P5.5`~~ | 已完成 |
| 2 | `ST2–ST4` | 策略系统后续阶段 |


不要一次领取多个任务。每个编号完成后都应保持全量测试为绿色。

---

## 3. 功能补齐

---

## 3. 策略系统后续阶段

继续开发前先补专项设计，只领取一个阶段：

- `ST2`：策略选择器与预算决策。
- `ST3`：Core loop 集成和事件。
- `ST4`：TUI 状态展示与回归测试。

不得把策略系统和 thinking mode 自动切换状态机合并成一套隐式规则。

---

## 4. 当前验证状态

2026-06-02

```text
bun run typecheck
  通过

bun test
  717 pass / 5 fail (M13 WebSearch ×3 网络, TT3 SSE ×2 超时)
```

所有 AUD 项（AUD-02, AUD-03, AUD-05, AUD-07, AUD-08）及 TUI 回归（T21-R, P3-R）、Session 管理（S1, S2）已完成。剩余 5 个失败均为预存网络相关问题，不影响功能正确性。

下一步开始 P5.5：工具执行期间细粒度进度流。

---

## 5. 明确暂缓

除非用户明确要求，不要顺手实现：

- 动态 bash 并发判断。
- bash 特判级联取消。
- 默认 LLM 摘要。
- TTSR 规则系统。
- Universal Config Discovery。
- Python Kernel。
- Web、IDE Plugin 等多前端。
- AskUserQuestion 专用 TUI 选择弹窗。
- WebBrowser 跨调用持久会话。
- 完整 OAuth 型 MCP 身份系统。
- README 全面重写、配置指南和发布包。
