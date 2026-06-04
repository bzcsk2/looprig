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
| 1 | `FG-60-R` best-effort 日志收尾 | Find_ground 已完成高风险项，剩余低风险日志和状态接入。 |
| 2 | `CTX-70` 文档和验收 | CTX-10/30/40/50 已完成，只剩交付验收。 |
| 3 | `OS-12/13-R` macOS/Windows 原生体验验收 | 三平台 CI 自动化已通过，仍需真实终端体验确认。 |

不要一次领取多个任务。每个编号完成后都应保持全量测试为绿色。

---

## 2. 后续任务

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
