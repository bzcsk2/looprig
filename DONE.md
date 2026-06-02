# Deepicode 完成记录

最后更新：2026-06-02

本文只记录当前代码中仍然成立的已完成功能和已验证修复。
未完成、待验收和明确暂缓事项统一见 [TODO.md](TODO.md)。历史审计上下文见 [ADVICE.md](ADVICE.md)。

---

## 1. 当前验证基线

本次整理时实际运行：

```bash
bun run typecheck
bun test
```

结果：

| 检查项 | 状态 |
|--------|------|
| TypeScript | `bun run typecheck` 通过 |
| 测试 | `688 pass / 6 fail`，共 `694` tests |
| 失败范围 | 见 TODO.md 第 8 节 |

---

## 2. 当前架构快照

```text
packages/cli/src/tui.ts
  └─ 注册 34 个静态 Agent Tool
     └─ ReasonixEngine.submit()
        └─ runLoop(LoopOptions)
           └─ StreamingToolExecutor.run()
              └─ AgentTool.execute(args, ToolContext)

ReasonixEngine.submit()
  → AsyncGenerator<LoopEvent>
  → packages/tui/src/bridge.tsx
  → TimelineItem[] + TurnView
  → packages/tui/src/DeepiMessages.tsx
```

| 主题 | 当前实现 |
|------|----------|
| 运行时 | Bun |
| API Provider | DeepSeek / Zen / Mimo |
| TUI | React 19 + `@deepicode/ink`，显示组件适配自 Reasonix |
| Core 事件 | `AsyncGenerator<LoopEvent>`，使用 role-based 事件模型 |
| 工具并发 | `shared` 并行，`exclusive` 串行 |
| 工具进度 | 已有 `tool_start`、`tool_progress: running/done` 粗粒度事件 |
| 会话持久化 | `.deepicode/sessions/*.jsonl`，best-effort append |
| 上下文 | ImmutablePrefix + AppendOnlyLog + VolatileScratch |
| 权限 | `PermissionEngine` 的 deny → allow → ask 判定 |
| Agent | Build Agent + Plan Agent |

---

## 3. 已完成能力

### 3.1 Core 与上下文

- SSE 流式解析：文本、reasoning、usage、tool call 和 done 事件。
- API 错误恢复：429 和 5xx 指数退避；连续流错误达到阈值后终止。
- provider tool finish reason 归一化，兼容多个命名变体。
- 空 tool-calls 防御、重复工具调用告警、最大循环轮数保护。
- ImmutablePrefix 指纹覆盖 system prompt 和 tool specs。
- ContextManager 按 user 轮次截断，保留完整 tool message 组。
- TokenizerPool 支持 Worker 调度、超时降级和 shutdown 清理。
- fold 决策支持 none / suggest / force，loop 使用 100ms fallback。
- SessionLoader 支持 read、list、recover、loadSession；恢复时由 Engine 过滤历史 system 消息。
- AsyncSessionWriter 队列上限为 500，溢出时优先淘汰旧 event，保留 messages 和 stats。

### 3.2 工具执行器

- `StreamingToolExecutor` 支持 shared 并行和 exclusive 串行。
- 工具结果按声明 index 顺序回写上下文。
- `toolCallIndex` 用于关联 tool delta、start、result 和 progress。
- 权限检查覆盖 shared 和 exclusive 两条路径。
- `ToolContext.signal` 传递到工具，支持中断。
- `ToolContext.invokeTool()` 支持嵌套调用并拒绝递归。
- Workflow 可以执行真实嵌套工具；后台 AgentTool 使用隔离子会话。
- P1 exactly-once：使用局部 `settled` 集合，成功、失败、拒绝和中断路径统一避免重复追加 tool result。
- loop 已移除中断后的整批盲补结果逻辑。

### 3.3 中途指令注入 Core

P2 已完成并通过对应 Core 测试：

- `CoreEngine.enqueueInstruction()` 返回 `queued / idle / ignored / full`。
- Engine 内部 `pendingInstructionQueue` 上限为 10。
- 工具批次完成后、最终回答结束前存在安全注入点。
- 注入内容作为普通 user message 进入上下文，不修改 system prompt。
- 注入消息写入 SessionWriter。
- interrupt 会清空待注入队列。

TUI 路由已开始接入，但仍有两个 bridge 测试待修复，因此不在此处标为完整闭环。

### 3.4 TUI

- 保留 Deepicode 自己的 `TimelineItem[] + TurnView` 状态模型。
- Reasonix 显示组件：Card、CardHeader、Markdown、StreamingCard、ToolCard、Spinner、主题 token。
- 流式 assistant 文本、reasoning 折叠显示、工具卡片、耗时和错误内联。
- 工具 key 使用 `toolCallIndex + sequence`，避免后续批次重复 index 覆盖历史记录。
- cancel 先调用 `respondPermission(false)`，再调用 `interrupt()`，避免权限 Promise 悬空。
- TUI `messageQueue` 保留串行提交语义。
- Ctrl+C：加载中取消；空闲时双击退出；终端清理顺序已固定。
- 多行输入、历史记录、Ctrl+方向键跳词、Ctrl+Backspace 删除前词。
- 斜杠命令自动补全。
- 中英文 i18n：`zh-CN / en`，`/lang` 切换并写入 `.deepicode/lang.json`。
- 长会话显示优化：React.memo、useMemo 和 Ink viewport culling。
- `Ctrl+F` 消息搜索与屏幕空间高亮。

### 3.5 安全

- PermissionEngine：Deny-first，支持 allow / deny 规则、序列化和恢复。
- HookManager：before / after / loop-event 三类 hook。
- before hook 异常 fail-safe 为 deny。
- after 和 loop-event hook 异常被隔离；支持 `setErrorObserver()` 观察错误。
- FileSnapshot：文件快照、恢复、SHA256 路径索引和稳定排序。
- 敏感路径规则覆盖 `.env*`、`.git`、密钥、证书、npmrc、AWS 凭据等。
- WebFetch 和 WebBrowser 执行协议校验、私网地址拒绝和重定向后复查。
- bash 使用 `bash -c`，设置非交互编辑器环境变量，限制危险命令，并支持超时后 SIGTERM → SIGKILL。

### 3.6 工具与 MCP

Build Agent 当前开放 `34` 个静态工具：

- `packages/tools`：`29` 个。
- MCP bridge：`5` 个。

Plan Agent 只开放：

```text
read_file
list_dir
grep
todowrite
```

MCP 已完成：

- `McpClient`：stdio JSON-RPC。
- `McpHost`：多 server 管理、后台加载配置、工具和资源发现。
- `ListMcpResources`、`ReadMcpResource`、`ListMcpTools`、`CallMcpTool`。
- `McpAuth`：项目级 token 存储，支持 set / list / delete；文件权限 `0600`，list 仅返回掩码。

Skills 已接入：

- `packages/tools/src/skills/` 当前包含 `52` 个 `SKILL.md`。
- Skill 工具支持 search / list / load。
- TUI 提供 `/skill` 命令。

### 3.7 运行时日志系统（LOG0-LOG7）

完整的运行时诊断系统，借鉴 Claude Code 日志架构：

**核心组件：**

- `RuntimeLogger`：默认关闭，异步写入 JSONL，支持事件过滤。
- `RuntimeLogSink`：单 sink 设计，timer-based flush（1s），队列超限自动丢弃。
- `parseDebugArgs()`：支持 `--debug`/`-d`/`--debug=<pattern>`/`--debug-file=<path>`。
- `createRuntimeLoggerFromEnv()`：从环境变量创建 logger。
- `registerShutdownFlush()`：优雅退出时 flush 日志。
- `cleanupOldLogs()`：后台清理过期日志。
- `checkDeprecatedDebugEnv()`：弃用 `DEEPICODE_DEBUG` 提示。

**已实现事件（全流程覆盖）：**

| 阶段 | 事件 |
|------|------|
| Core | `api.stream.first_event`, `api.usage`, `loop.stream.retry`, `loop.max_turns`, `reasoning.mode.switch` |
| Executor | `tool.batch.start/done`, `tool.execute.denied` |
| MCP | `mcp.host.start`, `mcp.server.connect.*`, `mcp.request.*` |
| Tools | `tool.result.overflow`, `tool.result.persisted` |
| Process | `process.shutdown.start/done` |

**配置：**

```text
DEEPICODE_LOG_LEVEL=debug|info|warn|error|off
DEEPICODE_LOG_FILE=<path>
DEEPICODE_LOG_FILTER=<pattern>
DEEPICODE_LOG_RETENTION_DAYS=7
DEEPICODE_LOG_MAX_TOTAL_MB=100
DEEPICODE_LOG_SYMLINK=1
DEEPICODE_TUI_DEBUG=1
DEEPICODE_TRACE=1
```

**Perfetto 追踪：**

- 简化版 Chrome Trace Event JSON 输出。
- Span 层级：interaction → llm_request → tool_batch → tool。
- 输出到 `.deepicode/traces/trace-<session-id>.json`。

### 3.8 自动推理模式切换（AS0-AS6）

基于 Provider 能力和规则的自动推理模式切换：

**核心组件：**

- `ProviderThinkingCapabilities`：Provider 思考能力映射。
- `ModeSelector`：纯规则评估器，状态机（idle → pending → active → cooldown）。
- `ModeStats`：切换统计和成功率追踪。

**已实现功能：**

| 阶段 | 内容 |
|------|------|
| AS0 | `reasoning_content` 工具链连续性修复 |
| AS1 | Provider 能力和请求映射 |
| AS2 | 纯规则评估器（120s cooldown） |
| AS3 | Controller 和 loop 集成 |
| AS4 | TUI 状态显示（StatusBar + bridge 事件） |
| AS5 | 手动覆盖 `/thinking` 命令 |
| AS6 | 统计追踪和成功率计算 |

**配置：**

```text
模式映射：
  off → thinking disabled
  low → thinking enabled
  medium → thinking enabled
  high → thinking + reasoningEffort=high
```

### 3.9 编辑链路

- `read_file`：路径解析、敏感路径拒绝、二进制检测、大小限制、行范围和截断提示。
- `write_file`：敏感路径拒绝、父目录创建和 10 MiB 限制。
- `edit`：stale-read 校验、CRLF 保持、hash-anchored 主路径和 fuzzy fallback。
- `hash-edit`：随机临时文件、原子 rename、权限位保持和二进制保护。
- `fuzzy-edit`：多 pass 匹配；遇到歧义时拒绝猜测。
- NotebookEdit：异步读写、临时文件 + rename、权限位保持。

---

## 4. 已完成专项

### 4.1 TUI 收尾

| 编号 | 内容 |
|------|------|
| F3/F5 | StreamingCard 与 token/s 估算 |
| T20 | 多行输入 |
| T21 | 斜杠命令自动补全 |
| T22 | 跳词和 Ctrl+Backspace |
| T30/T31/T32 | i18n 基础设施、文案替换、`/lang` |
| T40 | 长会话渲染优化 |
| T41 | 消息搜索 |

### 4.2 稳定性修复

| 编号 | 内容 |
|------|------|
| L2 | SessionWriter 有界队列 |
| L5 | 编辑链路 CRLF 归一化并恢复原格式 |
| N1 | NotebookEdit 异步原子写 |
| N2 | `/skill` 使用 `@deepicode/tools` 跨包导入 |
| N3 | SessionPicker 避免卸载后 setState |
| N4 | 空 tool call id 规范化 |
| N5 | client.ts 类型断言收紧 |

### 4.3 工具结果与指令注入

| 编号 | 内容 | 状态 |
|------|------|------|
| P0 | 工具结果、中断、权限和 TUI 队列契约测试 | 已建立 |
| P1 | tool result exactly-once | 已完成 |
| P2 | Core 中途指令队列和 loop 安全点 | 已完成 |
| P3 | TUI 注入优先路由和反馈 | 已实现，尚有 2 个 bridge 测试待收口 |

### 4.4 自动推理模式切换（AS0-AS6）

| 编号 | 内容 | 状态 |
|------|------|------|
| AS0 | reasoning_content 工具链连续性修复 | 已完成 |
| AS1 | Provider 能力和请求映射 | 已完成 |
| AS2 | 纯规则评估器 | 已完成 |
| AS3 | Controller 和 loop 集成 | 已完成 |
| AS4 | TUI 状态显示 | 已完成 |
| AS5 | 手动覆盖 `/thinking` 命令 | 已完成 |
| AS6 | 统计追踪 | 已完成 |

### 4.5 运行时日志系统（LOG0-LOG7）

| 编号 | 内容 | 状态 |
|------|------|------|
| LOG0 | 冻结并验收现有骨架 | 已完成 |
| LOG1 | 完善 Core 全链路日志 | 已完成 |
| LOG2 | 迁移 Claude Code 调试体验 | 已完成 |
| LOG3 | 接入 MCP 日志 | 已完成 |
| LOG4 | 定点接入 Tools 日志 | 已完成 |
| LOG5 | TUI 与 Ink 性能采样 | 已完成 |
| LOG6 | Perfetto Trace（可选） | 已完成 |
| LOG7 | 轮转、清理和文档 | 已完成 |

---

## 5. 已出现但尚未作为完整闭环验收

以下代码已经存在，但仍应按 `TODO.md` 或专项计划继续验收，不应在历史记录中写成完整交付：

| 范围 | 当前代码状态 | 仍需确认 |
|------|--------------|----------|
| P3 TUI 注入反馈 | bridge、App、StatusBar 已接线 | 修复 2 个 bridge 测试并跑全量 |
| P4 结果溢出持久化 | `result-persistence.ts` 已接入 executor，已有 10 个测试 | session 配额与清理策略尚未闭环 |
| P5 Hook 可观测性 | `setErrorObserver()` 和对应测试已存在 | 与当前工作区变更一起完成全量回归 |
| ST1 策略 tiers | `strategy/tiers.ts` 和 10 个测试已存在 | ST2–ST4 尚未实现 |

---

## 6. 重要历史修复摘要

以下修复仍然影响当前行为，但不再保留重复的逐轮流水账：

### Core 与 SSE

- `[DONE]` 前 finalize tool calls。
- SSE 支持多行 data、跨 chunk、半个 UTF-8 字符和超长单行。
- reader 生命周期使用 try/finally 释放。
- Bun abort error 兼容。
- API 计数在 done 事件更新，避免 usage 重复计数。
- 计费排除 cache token 双重计费。

### Session 与上下文

- JSONL 损坏行跳过，恢复最近合法 messages。
- session stats 使用最后一条累计记录。
- 上下文截断避免产生孤立 tool message。
- updateConfig 同步更新 contextWindow。

### 工具与安全

- grep 使用参数数组和 `--` 防选项注入。
- WebFetch 限制 http/https 并执行 SSRF 防护。
- glob、NotebookEdit、LSP、worktree 等路径处理已收紧。
- bash 不读取用户 `.bashrc`，并清理 timeout timer。
- safeStringify 截断后仍返回合法 JSON。
- TaskManager 使用 UUID，避免同毫秒 ID 碰撞。

### TUI

- assistant_final、reasoning 和工具调用历史不再因状态更新丢失。
- 同名工具和重复 index 不再覆盖历史卡片。
- 权限弹窗支持允许、始终允许和拒绝。
- 终端退出流程恢复 raw mode、鼠标和光标状态。

---

## 7. 仍需从 TODO 领取的工作

本节只提供入口，不展开待办细节：

- P3 bridge 测试收口。
- P4 配额和清理策略。
- P5 全量回归确认。
- P5.5 工具执行期间细粒度 progress：heartbeat、bash stdout/stderr 尾部预览和 transient 过滤。
- ST2–ST4 策略系统。
- `M10` write_file 父目录权限继承。
- `H1–H23` 困难场景和压力测试。
- 日志系统：批量接入 Tools 内部事件（bash timeout、web-fetch redirect 等）。
- 日志系统：TUI Ink logger adapter 注入。

详细约束见 [TODO.md](TODO.md) 和 `Deepicode-Full-Implementation-Plan.md`。

---

## 8. 文档维护规则

1. `DONE.md` 只记录已存在且仍然成立的能力。
2. 未完成事项移入 `TODO.md`，不要在 DONE 中维护第二套待办列表。
3. 每次更新基线必须实际运行 `bun run typecheck` 和 `bun test`。
4. 历史审计猜测、驳回项和低风险观察写入 `ADVICE.md`。
5. 不再追加重复的“第 N 轮修复”流水账；后续按专项编号记录结果。
