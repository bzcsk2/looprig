# Deepicode TODO 与开发交接指南

最后更新：2026-06-03

本文是后续 Agent 的唯一待办入口，只记录**尚未完成**、**待验收**、**明确暂缓**或**已经驳回**的工作。
已完成能力和历史实施结论见 [DONE.md](DONE.md)。Context 的专项设计见 [ADVICE.md](ADVICE.md)。

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
| 1 | `CTX-40` Engine 自动 trim/compact 触发 | CTX-30 已完成，按 ADVICE.md 顺序继续。 |
| 2 | `OS-12/13-R` macOS/Windows 原生验收 | 代码层面已就绪，需在原生环境验收。 |

不要一次领取多个任务。每个编号完成后都应保持全量测试为绿色。

---

## 2. 后续任务

### CTX-40：Engine 自动 trim/compact 触发

优先级：`P1`。CTX-30 已完成后执行。

当前状态：

- `getContextPolicy()` / `setContextPolicy()` / `getContextStatus()` 已存在。
- `submit()` 前会检查 budget。
- `trim` 时会自动裁剪。
- 会产生状态事件和 runtime logs。
- `ContextSummarizer` 接口和 `FakeSummarizer` 已就绪。

目标：

- `compact` 时调用真实 summarizer。
- summarizer 失败后的真实 fallback 链路。

执行要求：

1. 在 `ReasonixEngine.submit()` 里，保留"用户输入前检查"的入口。
2. `trim` 模式：到阈值就裁剪，裁剪成功后继续 submit。
3. `compact` 模式：调用 summarizer，成功后安装 summary，再删除旧历史，失败时 fallback trim。
4. 记录日志：记录前后 token、删除消息数、是否 fallback，不记录原始消息正文。
5. 编写 `packages/core/__tests__/engine-context-policy.test.ts` 测试文件。

验收命令：

```bash
bun test packages/core/__tests__/engine-context-policy.test.ts
bun run typecheck
bun test
```

### CTX-30：摘要区和 summarizer 接口

优先级：`P1`。CTX-10 已完成后执行。

当前状态：

- `buildMessages()` 已包含 summary 区域。
- `summaryTokens` 已计入 budget。
- `ContextManager.createSummaryMessage()` 已存在，但只是机械字符串拼接。

目标：

- 独立 `ContextSummary` 模块。
- `ContextSummarizer` 接口。
- fake summarizer 用于单测。

执行要求：

1. 新增 `packages/core/src/context/summary.ts`：维护 summary message，支持 replace / clear / read，summary 必须有明显标记。
2. 新增 `ContextSummarizer` 接口：输入旧消息、旧 summary、目标 token 预算、workspace 信息；输出新的 summary 文本和可选 usage 数据。
3. 先做 fake summarizer 用于单测，返回固定摘要。
4. 保证 summary 的插入顺序稳定：prefix → summary → log → scratch。
5. 编写 `packages/core/__tests__/context-summary.test.ts` 测试文件。

验收命令：

```bash
bun test packages/core/__tests__/context-summary.test.ts
bun run typecheck
bun test
```

### OS-12/13-R：macOS 与 Windows 原生验收

优先级：`P1`。三平台 CI 已通过后执行。

当前状态：

- 路径、文件 URL、权限位和 Monitor backend 的代码层已完成。
- 原生平台行为仍需按 `TEST.md` 的 `G3` 与 `H8` 验收。

执行要求：

1. macOS 验证 Bash、BSD `ps`、`df`、`osascript`、crontab、PTY 和路径边界。
2. Windows 验证 PowerShell backend、ConPTY、盘符、反斜杠、UNC path、中文与空格路径、进程树、Monitor、Scheduler、通知 fallback 和剪贴板。
3. GitHub Actions Matrix 只能覆盖自动化部分，不能替代真实终端体验确认。

关闭条件：

- `TEST.md` 中目标平台对应的 `G3` 自动化项通过。
- 项目负责人完成目标平台对应的 `H8` 人工验收。
- 结果写入 `DONE.md`。



---

## 3. 当前验证状态

- CTX-10：策略类型、配置加载和菜单解析 ✅ 已完成
- CTX-30：摘要区和 summarizer 接口 ✅ 已完成
- CTX-40：Engine 自动 trim/compact 触发 ⬜ 待开始

下一步：执行 `CTX-40` Engine 自动 trim/compact 触发。

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

