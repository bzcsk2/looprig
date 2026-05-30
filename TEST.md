# Deepicode 测试用例 — 待完成项

仅保留未测试项。已完成的 530+ 项见 `DONE.md § 测试覆盖完成汇总`。

## 约定

- 运行时：Bun + Vitest
- 临时目录：`mkdtempSync(join(tmpdir(), 'deepicode-xxx-'))` + afterEach cleanup
- Mock：`vi.mock` / `vi.spyOn`，外部 I/O 全部 mock
- 命名：`describe('ModuleName')` → `it('should ...')`
- 优先级：🔴 必须 → 🟡 应该 → 🟢 可选

---

## 1. Core 包 (`packages/core/`)

### 1.1 Context Manager

```
🟡 [ ] fold 决策 — force 时 yield status 警告事件（metadata 含 ratio）
🟡 [ ] fold 决策 — suggest 且 ratio > 75% 时 yield 推荐事件
🟡 [ ] fold 决策 — 100ms 超时降级不阻塞 loop 启动
```

### 1.2 Tokenizer Pool

```
🟢 [ ] alternate: main thread fallback 估算与 Worker 估算误差 < 20%（需要 Worker 环境）
```

### 1.3 Streaming Executor

```
🔴 [ ] exclusive 工具执行中收到 AbortSignal — 立即终止后续工具
🟡 [ ] tool 并发安全 — shared 工具并发 writes 未破坏文件状态
🟢 [ ] 工具执行超时 — 超时后子进程被 kill
```

### 1.4 Repair Pipeline

```
🟡 [ ] Truncation 截断后 JSON 合法但语义不同 — 低概率，不阻塞
```

### 1.5 Session

```
🔴 [ ] SessionLoader.read — 系统消息在恢复时被过滤（避免双 system）
🔴 [ ] loadSession — 清空当前上下文 + 加载新 session + 可继续新对话
🔴 [ ] recover — 静态工厂方法，返回可用的 engine 实例
🟢 [ ] stats 恢复后不连续 — 恢复前 token 用量已记录在 SessionSummary 中
```

### 1.6 SSE Client

```
🔴 [ ] reasoning_content 不进入 ChatMessage — client 剥离，不传回 API
🟡 [ ] 超长单行（>100K chars）— 不 OOM，逐字符处理
🟡 [ ] 并发 chatCompletionsStream 调用 — 请求体互不干扰
```

### 1.7 Engine + Loop

```
🔴 [ ] engine.interrupt 在工具执行中 — bash 子进程被 SIGKILL（需真实环境）
🔴 [ ] engine.interrupt 在 SSE 流中 — HTTP 连接被 abort（需真实 HTTP 连接）
🔴 [ ] submit 后 switchAgent — 工具列表更新，下一轮使用新 agent 的工具
🔴 [ ] fold 决策 force — yield status 警告 + metadata
🟡 [ ] 并发 submit — 第一个未完成时第二个 submit 返回错误
🟡 [ ] submit 中 engine.updateConfig — 不影响当前正在执行的 submit
🟡 [ ] SessionWriter enqueue — 每轮 submit 后写入 messages 快照
🟡 [ ] 超长对话（50 轮+）— fold 触发 + 截断生效，不 OOM
```

### 1.8 Query Engine ✅ 全部完成

### 1.9 Config + Agent ✅ 全部完成

---

## 2. Tools 包 (`packages/tools/`)

### 2.1 read_file ✅ 全部完成

### 2.2 write_file

```
🟢 [ ] 权限继承 — 父目录的 mode 被新文件继承
```

### 2.3 edit

```
🟡 [ ] 并发 edit — 不同文件的 edit 可并行执行
🟡 [ ] 极端文件 — 单行 1MB（无换行符）→ fuzzy pass 降级处理
🟡 [ ] 极端文件 — 10 万行 → hash-edit 流式处理不超 500ms
```

### 2.4 bash

```
🔴 [ ] 超时 — 死循环 / sleep 60 → timeout_ms 后 SIGKILL（需真实等待）
🟡 [ ] 子进程 exit 后 stdout 未完全消费 → 进程被回收，无僵尸
🟡 [ ] detached 子进程 — 主进程崩溃后子进程组存活（已知限制）
```

### 2.5 list_dir / grep / glob

```
🟡 [ ] glob: Bun.Glob 不可用 → fallback 或 error
🟡 [ ] grep: rg 不可用回退 grep → --include 参数兼容
```

### 2.6 Task Manager

```
🔴 [ ] TaskManager 完整流程 — create → get → update → stop
```

### 2.7 WebFetch

```
🔴 [ ] 正常 HTTPS URL → 返回 content + bytes + code
🔴 [ ] HTTP URL → 自动升级 HTTPS
🔴 [ ] 内网 IP 直接访问（127.0.0.1 / 192.168.x.x / 10.x.x.x）→ 拒绝
🔴 [ ] 内网 hostname DNS 解析（localhost / internal.corp）→ 异步校验后拒绝
🔴 [ ] redirect: "manual" — 不自动跟随重定向
🔴 [ ] 超时 — 30s 无响应 → AbortError
🔴 [ ] HTML 内容 → htmlToText 提取纯文本
🔴 [ ] 超大内容（>10MB）→ 返回错误
🟡 [ ] 非 HTTP 协议（file:/// ftp://）→ 拒绝
🟡 [ ] DNS 解析失败 → 拒绝（安全策略）
🟢 [ ] 输出截断 > maxLen → truncation notice
```

### 2.8 WebSearch

```
🔴 [ ] 正常 Google 搜索 → 解析结果页 HTML → 返回 title/url/snippet
🔴 [ ] 空 query → 拒绝
🔴 [ ] num_results 默认 5，上限 10
🔴 [ ] HTML 解析无结果 → 返回空数组
🟡 [ ] Google HTML 结构变更 → 返回空结果不崩溃（标注实验性）
🟢 [ ] 搜索超时 → 返回结构化错误
```

### 2.9 NotebookEdit

```
🟡 [ ] 路径穿越保护
```

### 2.10 其余工具

```
🟡 [ ] Cron: crontab 文件不存在 → 自动创建
```

### 2.11 Sensitive / SafeStringify / StaleRead ✅ 全部完成

---

## 3. Skills 系统

```
🔴 [ ] SkillTool load 不存在 → 返回错误
🟡 [ ] skill 排序 — 按 matching score 降序
🟡 [ ] 条件技能（paths frontmatter）— 不命中时不加载
```

---

## 4. MCP 包 (`packages/mcp/`)

### 4.1 McpClient

```
🔴 [ ] connect → initialize(2024-11-05) → 收到 protocolVersion → 发送 notifications/initialized
🔴 [ ] listTools → 返回 tools 数组，空数组
🔴 [ ] callTool → 发送 tools/call，返回 result
🔴 [ ] callTool → MCP server 返回 error → handler.reject
🔴 [ ] listResources / readResource → 标准流程
🔴 [ ] 请求超时 30s → reject McpError + pending 清理
🔴 [ ] pending 不泄漏 — 超时/exit/error 三种路径均清理
🔴 [ ] 子进程 exit（非 0）→ 所有 pending reject + _connected=false
🔴 [ ] 子进程 error → 所有 pending reject
🟡 [ ] Content-Length header 模式 — 解析 Content-Length: N\r\n\r\n{...}
🟡 [ ] 多行 buffer — 一次 data 事件含多条 JSON-RPC 消息
🟡 [ ] connect 时子进程 binaries 不在 PATH → error 事件
🟢 [ ] disconnect → SIGTERM + _connected=false，不 reject pending
```

### 4.2 McpHost

```
🔴 [ ] loadConfig — .deepicode/mcp.json 解析 servers 数组
🔴 [ ] 多 server 管理 — 每个 server 独立 McpClient
🔴 [ ] connectAll → 所有 server 并发连接，失败的不影响成功的
🔴 [ ] 工具自动注册 — MCP tools → AgentTool 包装 → ToolRegistry
🟡 [ ] MCP server 动态加入/离开 — toolsChanged 事件触发重新注册
🟡 [ ] 两个 MCP server 有同名工具 — 按 server 名加前缀
🟢 [ ] 工具执行错误 → MCP error message 透传
```

### 4.3 MCP 工具

```
🔴 [ ] ListMcpResources → 聚合所有 MCP server 资源
🔴 [ ] ReadMcpResource → 按 URI 读取指定资源
```

---

## 5. Security 包 (`packages/security/`)

### 5.1 PermissionEngine

```
🟡 [ ] isAllowed / isDenied 快捷方法 — 等价于 decide().decision
🟡 [ ] 自定义规则从 JSON 加载
```

### 5.2 HookManager

```
🔴 [ ] afterToolCall — 抛异常不中断主流程
```

### 5.3 FileSnapshot

```
🟡 [ ] SHA256 路径索引 — 相同内容的文件共享快照
```

---

## 6. TUI + CLI

### 6.1 Bridge

```
🔴 [ ] assistant_delta — 首次创建 assistant block，后续增量追加 content
🔴 [ ] assistant_final — 确认 assistant 消息完成，清除 streamingText
🔴 [ ] reasoning_delta — 独立追踪 reasoningText，不混入 streamingText
🔴 [ ] tool_start — 创建工具状态（running）
🔴 [ ] tool — 更新为 done + 设置 output
🔴 [ ] tool_progress(running) — 更新状态为 running
🔴 [ ] tool_progress(done) — 更新状态为 done
🔴 [ ] tool_call_delta — 不被忽略，正确处理
🔴 [ ] usage — tokens 累加 + contextUsage 使用累积值
🔴 [ ] error — 设置 error state
🔴 [ ] warning — 追加到 warnings 数组
🔴 [ ] done — finally 清理（isLoading/streamingText/reasoningText/activeTools）
🔴 [ ] status(interrupted) — 特殊处理不写入 warnings
🔴 [ ] status(tools_completed) — 特殊处理不写入 warnings
🔴 [ ] 同名工具 + 相同 toolCallIndex — 不冲突
🔴 [ ] cancel — engine.interrupt + 立即 isLoading=false（不等 drain）
🟡 [ ] 事件乱序 — tool_progress 在 tool_start 之前到达
🟡 [ ] 消息过多（500+）— 渲染不崩
```

### 6.2 Terminal Cleanup (SIGINT)

```
🔴 [ ] cleanupTerminal 执行顺序 — mouse↓ → unmount → drainStdin → detachForShutdown → SHOW_CURSOR
🔴 [ ] loading 中 Ctrl+C → cancel + raw mode 保持
🔴 [ ] idle 双击 Ctrl+C — 第一次 StatusBar 提示 → 2s 内第二次退出
🔴 [ ] idle 单击超时 — 2s 后 exitTimer 自动清除，无状态残留
🔴 [ ] /exit 命令 → cleanupTerminal + process.exit(0)
🔴 [ ] exitOnCtrlC: false — Ink 不拦截 \x03
🟡 [ ] SIGINT+Bridge 竞态 — cancel 后 bridge finally 执行，状态一致
🟡 [ ] 多次快速 Ctrl+C — exitPending 防止重复 exit
```

---

## 7. 集成 / 压力 / 边界

### 7.1 多轮工具链闭环

```
🔴 [ ] Task 完整流程 — Create → List → Get → Update(status→completed) → Stop
```

### 7.2 错误恢复闭环

```
🔴 [ ] 连续 2 次 stream 失败 — 自动重试，第三次失败终止
🔴 [ ] repair pipeline 失败 — 不触发 API 重试，tool 返回 error
```

### 7.3 压力 / 边界

```
🔴 [ ] 50 轮对话 — fold 触发 + 截断生效，响应时间不超过首轮的 2x
🔴 [ ] 超长 JSON tool arguments（50K chars）— repair 不超时
🔴 [ ] 并发 submit 拒绝 — engine 返回错误而非崩溃
🔴 [ ] 10MB 文件 read_file — 截断 + notice，不 OOM
🟡 [ ] 100 个工具注册 — ToolRegistry.toToolSpecs 不超 10ms
🟡 [ ] 1000 行 JSONL session 恢复 — 加载时间 < 1s
🟢 [ ] 极端文件名（含空格 / Unicode / emoji）— 所有文件操作正常
```

### 7.4 安全

```
🔴 [ ] bash 敏感文件 — cat .env / cat ~/.ssh/id_rsa 被拒绝
🔴 [ ] web-fetch 内网 IP — 127.0.0.1 / 192.168.x.x / 10.x.x.x 被拒绝
🔴 [ ] glob / notebook-edit / monitor file 路径穿越 — realpath 校验
🟡 [ ] SQL 注入尝试 — bash 命令中含 '; DROP TABLE → 拒绝（不在 DENY_PATTERNS 中，但无害）
```

---

## 运行方式

```bash
# 全体测试（533 pass, 3 skip, 0 fail, 44 files ✅）
bun test

# 带文件监控
bun test --watch

# 单个包
bun test packages/core/
bun test packages/tools/
bun test packages/security/
bun test packages/mcp/

# 单个测试文件
bun test packages/core/__tests__/context.test.ts

# 类型检查（0 errors ✅）
bun run typecheck

# 覆盖率报告
bun test --coverage
```
