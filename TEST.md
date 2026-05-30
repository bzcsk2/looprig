# Deepicode 测试用例 — 待完成项

仅保留未测试项。已完成的 530+ 项见 `DONE.md § 测试覆盖完成汇总`。

难度标记：🟢 简单 | 🟡 中等 | 🔴 困难

## 约定

- 运行时：Bun + Vitest
- 临时目录：`mkdtempSync(join(tmpdir(), 'deepicode-xxx-'))` + afterEach cleanup
- Mock：`vi.mock` / `vi.spyOn`，外部 I/O 全部 mock
- 命名：`describe('ModuleName')` → `it('should ...')`
- 优先级：🔴 必须 → 🟡 应该 → 🟢 可选

---

## 🟢 简单（已全部完成 ✅）

| # | 模块 | 项 | 结果 |
|---|------|----|------|
| S1 | 1.4 Repair | Truncation 截断后 JSON 合法但语义不同 | ✅ |
| S2 | 1.6 SSE Client | `reasoning_content` 不进入 `ChatMessage` | ✅ |
| S3 | 2.5 list/grep/glob | `Bun.Glob` 不可用 → fallback | ✅ |
| S4 | 2.5 list/grep/glob | `rg` 不可用回退 `grep` | ✅ |
| S5 | 2.6 Task Manager | 完整流程 — create → get → update → stop | ✅ |
| S6 | 2.9 NotebookEdit | 路径穿越保护 | ✅ |
| S7 | 2.10 其余工具 | Cron: crontab 不存在 → 自动创建 | ✅ |
| S8 | 3. Skills | SkillTool load 不存在 → 返回错误 | ✅ |
| S9 | 3. Skills | skill 排序 — 按 matching score 降序 | ✅ |
| S10 | 5.1 Permission | `isAllowed` / `isDenied` 快捷方法 | ✅ |
| S11 | 5.1 Permission | 自定义规则从 JSON 加载 | ✅ |
| S12 | 7.4 安全 | bash 敏感文件（命令错误而非拒绝） | ✅ |
| S13 | 7.4 安全 | web-fetch 内网 IP 拒绝 | ✅ |
| S14 | 7.4 安全 | glob / notebook-edit / monitor 路径穿越 | ✅ |
| S15 | 7.4 安全 | SQL 注入尝试（无害不拒绝） | ✅ |

## 🟡 中等（需要异步控制或 mock 技巧）

| # | 模块 | 项 | 测试文件 |
|---|------|----|---------|
| M1 | 1.1 Context | fold force → yield status 警告事件 | `context.test.ts` |
| M2 | 1.1 Context | fold suggest + ratio>75% → yield 推荐事件 | `context.test.ts` |
| M3 | 1.1 Context | fold 100ms 超时降级不阻塞 loop | `context.test.ts` |
| M4 | 1.5 Session | SessionLoader 系统消息被过滤 | `session.test.ts` |
| M5 | 1.5 Session | loadSession — 清空+加载+继续 | `session.test.ts` |
| M6 | 1.5 Session | recover — 静态工厂返回可用 engine | `session.test.ts` |
| M7 | 1.6 SSE Client | 超长单行 >100K chars 不 OOM | ✅ |
| M8 | 1.6 SSE Client | 并发 chatCompletionsStream 不干扰 | ✅ |
| M9 | 1.7 Engine+Loop | SessionWriter enqueue 每轮写入 | `engine.test.ts` |
| M10 | 2.2 write_file | 权限继承 — 父目录 mode 继承 | `write-file.test.ts` |
| M11 | 2.3 edit | 并发 edit — 不同文件可并行 | ✅ |
| M12 | 2.7 WebFetch | 正常 HTTPS + HTTP 升级 + redirect + HTML 提取 + 超大 + 截断 | `web-fetch.test.ts` |
| M13 | 2.8 WebSearch | 全套 6 项（搜索/空/限制/无结果/结构变更/超时） | `web-search.test.ts` |
| M14 | 5.2 HookManager | afterToolCall 异常不中断主流程 | ✅ |
| M15 | 5.3 FileSnapshot | SHA256 路径索引 | ✅ |
| M16 | 7.1 多轮工具链 | Task 完整流程 — Create→List→Get→Update→Stop | `task-manager.test.ts` |
| M17 | 7.2 错误恢复 | 连续 stream 失败 → 重试，第三次终止 | ✅（已有测试覆盖） |
| M18 | 7.2 错误恢复 | repair 失败 → 不触发 API 重试 | ✅（已有测试覆盖） |

## 🔴 困难（需要真实环境/大量数据/复杂状态机）

| # | 模块 | 项 | 原因 |
|---|------|----|------|
| H1 | 1.3 Streaming | AbortSignal 终止后续工具 | 需要真实子进程+信号 |
| H2 | 1.3 Streaming | shared 工具并发安全 | 竞态条件，Promise.all+验证 |
| H3 | 1.3 Streaming | 工具执行超时 | 需要真实超时控制 |
| H4 | 1.7 Engine | interrupt 在工具执行中 | 需要真实 bash 子进程 |
| H5 | 1.7 Engine | interrupt 在 SSE 流中 | 需要真实 HTTP 连接 |
| H6 | 1.7 Engine | submit 后 switchAgent | 状态机复杂 |
| H7 | 1.7 Engine | fold force 决策 | 同 M1 但集成场景 |
| H8 | 1.7 Engine | 并发 submit | 状态机竞态 |
| H9 | 1.7 Engine | submit 中 updateConfig | 状态机竞态 |
| H10 | 1.7 Engine | 超长对话 50 轮+ | 大量数据构造 |
| H11 | 2.3 edit | 极端文件 1MB 单行 | 大文件构造 |
| H12 | 2.3 edit | 极端文件 10 万行 | 大文件+性能断言 |
| H13 | 2.4 bash | 超时 sleep 60 | 真实等待/fakeTimers |
| H14 | 2.4 bash | stdout 未完全消费 | 真实进程管理 |
| H15 | 2.4 bash | detached 子进程 | 真实进程管理 |
| H16 | 2.7 WebFetch | 超时 30s / DNS 失败 | 需要 mock 超时 |
| H17 | 4.1 McpClient | 全套 12 项 | JSON-RPC stdio mock 框架 |
| H18 | 4.2 McpHost | 全套 6 项 | 依赖 McpClient |
| H19 | 4.3 MCP Tools | ListMcpResources / ReadMcpResource | 依赖 McpHost |
| H20 | 6.1 Bridge | 全套 18 项 | TUI 状态机，难隔离 |
| H21 | 6.2 Terminal | 全套 8 项 | Ink/SIGINT 环境 |
| H22 | 7.3 压力 | 50 轮 / 50K JSON / 10MB 文件 | 大量数据 |
| H23 | 7.3 压力 | 100 个工具 / 1000 行 JSONL / 极端文件名 | 大量数据 |

---

## 运行方式

```bash
# 全体测试
bun test # 561 pass, 3 skip, 0 fail, 45 files ✅

# 带文件监控
bun test --watch

# 单个包
bun test packages/core/
bun test packages/tools/
bun test packages/security/
bun test packages/mcp/

# 类型检查（0 errors ✅）
bun run typecheck

# 覆盖率报告
bun test --coverage
```
