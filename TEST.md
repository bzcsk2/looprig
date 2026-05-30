# Deepicode 测试用例

覆盖 7 个包、42+ 模块。按深度分层：单元测试 → 集成测试 → 压力/边界测试。

## 约定

- 运行时：Bun + Vitest
- 临时目录：`mkdtempSync(join(tmpdir(), 'deepicode-xxx-'))` + afterEach cleanup
- Mock：`vi.mock` / `vi.spyOn`，外部 I/O 全部 mock
- 命名：`describe('ModuleName')` → `it('should ...')`
- 优先级：🔴 必须 → 🟡 应该 → 🟢 可选

---

## Mock 基础设施（测试可执行的前提，🔴 必须优先建）

### tests/helpers/mock-server.ts

```ts
// 模拟 DeepSeek API SSE 端点，支持：
// - 可编程的 chunk 序列（{delta, tool_calls, usage, finish_reason}）
// - 可编程的延迟（模拟网络延迟）
// - 可编程的错误响应（429/500/502/503）
// - 任意 chunk 切分（1字节 / 半个UTF-8 / 半个JSON行）
```

### tests/helpers/mock-mcp-process.ts

```ts
// 模拟 MCP stdio 子进程，支持：
// - initialize → tools/list → tools/call → resources/list 标准序列
// - 可编程的响应延迟 / 超时
// - 进程退出（exit code ≠ 0）
// - Content-Length header 模式
```

### tests/helpers/mock-tools.ts

```ts
// 共享 mock 工具工厂，支持：
// - 可编程的执行结果（成功 / isError / 超时 / 抛异常）
// - 可编程的 concurrency（shared / exclusive）
// - 执行顺序追踪（验证串行/并行）
```

---

## 1. Core 包 (`packages/core/`)

### 1.1 Context Manager

```
🔴 [x] buildMessages 返回防御性拷贝 — 外部修改不污染内部
🔴 [x] 截断边界 — cutFrom 落在 assistant(tool_calls) 上，反向扫描切到下一个 user
🔴 [x] 截断边界 — 连续多轮 tool 调用（每轮 3+ tool_calls），截断后消息组完整
🔴 [x] 截断边界 — maxRounds=3 且对话全为 tool 交互，不产生孤立的 tool/assistant
🟡 [x] ImmutablePrefix.cacheKey — system prompt 变化导致不同 key
🟡 [x] ImmutablePrefix.cacheKey — toolSpecs 变化导致不同 key（新增/删除工具）
🟡 [x] ImmutablePrefix.cacheKey — fewShots 变化导致不同 key
🟡 [x] ContextManager.startTurn — 连续多轮 startTurn 不残留上轮 scratch
🟡 [ ] fold 决策 — force 时 yield status 警告事件（metadata 含 ratio）
🟡 [ ] fold 决策 — suggest 且 ratio > 75% 时 yield 推荐事件
🟡 [ ] fold 决策 — 100ms 超时降级不阻塞 loop 启动
🟡 [x] estimateTokens — 包含 reasoning_content 的消息额外估算
🟡 [x] estimateTokens — 超长消息（>500K chars）不阻塞主线程（600K chars < 2s）
🟢 [x] maxRounds=0 不截断
🟢 [x] maxRounds 负值当作 0
```

### 1.2 Tokenizer Pool

```
🔴 [~] Worker 启动并返回精确 token 估算 — fallback 路径已验证（Bun 不支持 Worker，跳过真实 Worker 测试）
🔴 [~] Worker 超时 5s 降级主线程估算 — 设计已验证，5s 真实超时跳过
🔴 [x] 连续 3 次超时标记 unhealthy，第 4 次直接走 fallback（状态机制验证）
🔴 [x] 正常响应后 consecutiveTimeouts 重置为 0
🔴 [x] 多个并发 estimate() 调用 — Map 调度 O(1)，结果按 id 匹配
🔴 [~] Worker crash 自动降级不抛异常（fallback 路径已验证）
🟡 [x] Worker 不可用（Bun 不支持 Worker 线程）— 构造时 healthy=false
🟡 [x] shutdown() 终止 Worker + 清空 pending tasks
🟢 [ ] alternate: main thread fallback 估算与 Worker 估算误差 < 20%（需要 Worker 环境）
```

### 1.3 Streaming Executor

```
🔴 [x] 3 shared 工具 + 2 exclusive 工具交叉执行 — shared 并行 → exclusive 串行 → shared 并行
🔴 [x] shared batch 中某工具抛异常 — 其他工具继续执行，异常工具返回 error 事件
🔴 [ ] exclusive 工具执行中收到 AbortSignal — 立即终止后续工具（executor 不主动检查 signal，需工具内自行处理）
🔴 [x] 事件顺序（exclusive）：tool_start → tool_progress(running) → appendToolResult → tool/error → tool_progress(done)
🔴 [x] 事件顺序（shared）：tool_start → tool_progress(running) → [并行] → 按 index 排序的 tool/error → tool_progress(done)
🔴 [x] 未知工具名 — 返回 error 事件（非 tool 事件），不中断其他工具
🔴 [x] 参数 JSON parse 失败 → repair pipeline → 成功则执行，失败则 error
🔴 [x] repair pipeline 全部失败 — 返回 error 事件，不触发 API 重试
🟡 [x] permission deny (from PermissionEngine) → 跳过执行，返回 error
🟡 [x] permission ask + hook beforeToolCall 返回 deny → 被拦截
🟡 [x] permission ask + hook beforeToolCall 返回 allow → 放行执行
🟡 [x] permission ask + hook beforeToolCall 抛异常 → fail-safe 返回 deny
🟡 [x] 多 hook 链 — 第一个 hook 返回 deny/allow 后不执行后续 hook
🟡 [ ] tool 并发安全 — shared 工具并发 writes 未破坏文件状态
🟢 [ ] 工具执行超时 — 超时后子进程被 kill
🟢 [x] 工具输出含 `\x00` 二进制 — safeStringify 不抛异常（bash binary 检测 + safeStringify 单元）
```

### 1.4 Repair Pipeline

```
🔴 [x] Scavenge — 6 子策略逐个尝试，首个成功即返回
🔴 [x] Scavenge — 完整 JSON 嵌在 markdown 代码块中（```json {...} ```）→ 提取成功
🔴 [x] Scavenge — 单引号包裹的 JSON（{'key': 'value'}）→ 转为双引号
🔴 [x] Scavenge — 末尾多余逗号（{"a": 1,}）→ 清除后解析成功
🔴 [x] Scavenge — 缺少闭合花括号（{"a": 1）→ 补充 } 后解析成功
🔴 [x] Scavenge — 缺少闭合引号（{"a": "val）→ 补充 " 后解析成功（1g 组合策略）
🔴 [x] Truncation — 逐步从末尾 -50 chars 截断，找到合法 JSON 边界
🔴 [x] Truncation — 截断 < 100 chars 仍未找到 → 返回失败
🔴 [x] Storm — 最简单的 key-value 提取（{"command": "ls"} → {command: "ls"}）
🔴 [x] Storm — 多 key-value 时只取第一个（当前实现）→ 不报错
🔴 [x] 三阶段全部失败 → 返回 {success: false}
🟡 [ ] Truncation 截断后 JSON 合法但语义不同 — 低概率，不阻塞
🟡 [x] 嵌套 JSON（tool_calls 参数含嵌套对象）— Scavenge 提取最外层花括号
🟢 [x] 空字符串输入 → 1d wrap 为 `{}`（空对象），当前行为合理（B1 推断有误，非 bug）
```

### 1.5 Session

```
🔴 [x] AsyncSessionWriter enqueue → flushSoon → JSONL 文件包含完整行
🔴 [x] AsyncSessionWriter 连续 100 次 enqueue → 批量写入（50条/批），不丢失
🔴 [x] AsyncSessionWriter 不可序列化 payload（循环引用）→ 不中断流，后续正常
🔴 [x] SessionLoader.list — 扫描 .deepicode/sessions/ 返回按时间倒序的前 20 条
🔴 [x] SessionLoader.list — stats 记录的 token 用量正确累加
🔴 [x] SessionLoader.list — 空目录返回空数组
🔴 [x] SessionLoader.list — 损坏 JSONL 文件跳过不崩溃
🔴 [x] SessionLoader.read — 从后向前扫描，返回最近的合法 messages 快照
🔴 [x] SessionLoader.read — 全部行损坏返回空数组
🔴 [ ] SessionLoader.read — 系统消息在恢复时被过滤（避免双 system）
🔴 [ ] loadSession — 清空当前上下文 + 加载新 session + 可继续新对话
🔴 [ ] recover — 静态工厂方法，返回可用的 engine 实例
🟡 [x] SessionLoader.read — 最后一行 JSON 被截断（进程崩溃模拟）→ 回退到上一完整快照
🟡 [x] SessionLoader.read — JSONL 含 0x00 字节不崩溃
🟡 [x] AsyncSessionWriter — 目录不存在时自动 mkdir
🟡 [x] 跨目录 session — sessionDir 基于 cwd，不同 cwd 隔离
🟢 [ ] stats 恢复后不连续 — 恢复前 token 用量已记录在 SessionSummary 中（OBS-2）
```

### 1.6 SSE Client

```
🔴 [x] 正常流 — text_delta → tool_call_delta → usage → finish_reason=stop
🔴 [x] 工具调用流 — tool_call_start → tool_call_delta(多次) → tool_call_end → finish_reason=tool_calls
🔴 [x] R1 thinking 流 — reasoning_delta(多次) → text_delta → usage
🔴 [ ] reasoning_content 不进入 ChatMessage — client 剥离，不传回 API
🔴 [x] usage 累加 — 多 chunk 的 usage.prompt_tokens 正确累加
🔴 [x] [DONE] 标记 — 流结束信号，不进入消息
🔴 [x] 429 响应 — HTTP 429 → 指数退避重试（1s/2s/4s + jitter）
🔴 [x] 500/502/503 响应 — 可重试服务端错误，退避重试
🔴 [x] 400/401 响应 — 不重试，直接抛出
🔴 [x] 连续 3 次 stream 失败 → loop 终止，yield error
🔴 [x] 1-2 次失败自动重试 → loop 继续
🔴 [x] 重试间 jitter — 两次重试的间隔不完全相同
🔴 [x] finish_reason 5 种变体 — tool_calls / tool_use / toolUse / toolCall / tool 均识别
🟡 [ ] SSE 任意位置分片 — 双层缓冲区（外层拼 chunk / 内层按 \n\n 切消息）
🟡 [x] SSE 1 字节 chunk — 不崩溃，正确拼接
🟡 [x] SSE 半个 UTF-8 字符 — 多字节字符跨 chunk 边界，正确解码
🟡 [x] SSE 半个 JSON 行 — 消息体跨 \n\n 边界，等待下一个 chunk
🟡 [ ] 超长单行（>100K chars）— 不 OOM，逐字符处理
🟡 [ ] 并发 chatCompletionsStream 调用 — 请求体互不干扰
🟢 [x] isToolUseFinishReason — 未知变体返回 false，不影响流
🟢 [x] finishReasonYielded 标记 — 防止 done 事件重复发射
```

### 1.7 Engine + Loop

```
🔴 [x] 完整一轮对话 — submit → assistant_delta → done
🔴 [x] 多轮对话（含 3 次工具调用）— submit → tool_start → tool → submit → assistant_delta → done
🔴 [~] engine.interrupt — 终止当前 submit，yield status(interrupted)（mock SSE 同步完成，真实中断需集成测试验证）
🔴 [ ] engine.interrupt 在工具执行中 — bash 子进程被 SIGKILL（需真实环境）
🔴 [ ] engine.interrupt 在 SSE 流中 — HTTP 连接被 abort（需真实 HTTP 连接）
🔴 [x] 空 toolCalls 数组 — yield warning + break，不死循环
🔴 [ ] submit 后 switchAgent — 工具列表更新，下一轮使用新 agent 的工具
🔴 [x] engine.updateConfig — provider/model/apiKey 实时生效（基础验证）
🔴 [x] prefix.build 短路 — cacheKey 未变时跳过 rebuild
🔴 [ ] fold 决策 force — yield status 警告 + metadata
🟡 [ ] 并发 submit — 第一个未完成时第二个 submit 返回错误
🟡 [ ] submit 中 engine.updateConfig — 不影响当前正在执行的 submit
🟡 [ ] SessionWriter enqueue — 每轮 submit 后写入 messages 快照
🟡 [ ] 超长对话（50 轮+）— fold 触发 + 截断生效，不 OOM
🟢 [x] getState — 返回当前 agent 名 + 活跃状态
🟢 [x] switchAgent — 切换 agent 后 getAgentName 反映新名称
```

### 1.8 Query Engine

```
🔴 [x] stream() 产出 engine.submit 的全部事件
🔴 [x] onEvent 回调异步执行，不阻塞事件流
🔴 [x] onEvent 回调抛异常 → 不影响其他回调和事件流
🔴 [x] unsubscribe → 移除回调，不再接收事件
🔴 [x] query() 收集所有 assistant_delta 拼接为完整字符串
🟡 [x] 多个 onEvent 回调 → 按注册顺序调用
🟡 [x] interrupt() 委托给 engine.interrupt
🟢 [x] 空响应 → query() 返回空字符串
```

### 1.9 Config + Agent

```
🔴 [x] loadConfig — 环境变量 DEEPICODE_PROVIDER 覆盖默认 zen
🔴 [x] loadConfig — DEEPSEEK_API_KEY / ZEN_API_KEY 独立 env var
🔴 [x] PROVIDERS.zen.defaultKey = "public" — ModelPicker 自动跳过 key 输入
🔴 [x] getApiKeyEnvVar — 每个 provider 返回正确的 env var 名
🔴 [x] saveLastConfig / loadLastConfig — provider + model + baseUrl 持久化往返
🔴 [x] loadLastConfig — 文件不存在返回 null，不崩
🔴 [x] getAgent('build') — toolNames 包含全量工具（30+）
🔴 [x] getAgent('plan') — toolNames 仅含只读（read/list_dir/grep/todowrite）
🔴 [x] getAgent('unknown') — 回退到 build
🟡 [x] loadLastConfig — JSON 格式损坏，返回 null 不崩
🟡 [x] agentConfigFor — 自定义 systemPrompt 覆盖默认
🟢 [x] buildPiModel（死代码）— 不调用，不影响功能
```

---

## 2. Tools 包 (`packages/tools/`)

### 2.1 read_file

```
🔴 [x] 小文本文件（<1KB）— 返回完整内容
🔴 [x] 大文本文件（5MB）— 返回前 200K chars + truncation notice（max_chars 截断已验证）
🔴 [x] 二进制文件（/dev/urandom 或随机字节）— 不崩溃，读为文本（无显式 warning，需 source 加强）
🔴 [x] 文件不存在 → {isError: true, content: "File not found..."}
🔴 [x] 敏感路径（.env / api-key / .git/config / id_rsa）→ 拒绝
🔴 [x] 相对路径基于 ctx.cwd 解析（ctx.cwd=/app, path=README → /app/README）
🟡 [x] 超过 10MB 文件 → 返回错误
🟡 [x] offset + limit 参数 — 指定行范围
🟡 [x] stale-read — 读后 recordRead，下次 edit 前 checkStale 检测变更（read_file → modify → edit 全流程）
🟢 [x] 空文件 → 返回空内容字符串
```

### 2.2 write_file

```
🔴 [x] 创建新文件 → 写入内容，返回成功
🔴 [x] 覆盖已有文件 → 内容被替换，返回成功
🔴 [x] 递归创建目录 — 路径含不存在的子目录
🔴 [x] 敏感路径拒绝 — .env / api-key / 私钥 / .git/
🔴 [x] 相对路径基于 ctx.cwd 解析
🟡 [x] 空 content → 创建空文件
🟡 [x] 二进制内容 → safeStringify 处理（hasBinaryEncoding 检测 + safeStringify 不抛 + \\x00 不崩溃）
🟢 [ ] 权限继承 — 父目录的 mode 被新文件继承
```

### 2.3 edit

```
🔴 [x] hash-anchored 精确替换 — oldHash 匹配，单次替换成功
🔴 [x] hash-anchored 多行替换 — 跨 5 行 old_string 替换
🔴 [x] hash-anchored oldHash 不匹配 → 拒绝写入，返回 null
🔴 [x] hash-anchored old_string 在文件中多次出现 → 替换第一次（indexOf 行为）
🔴 [x] hash-anchored → fallback fuzzy — oldHash 未传时走流式 hash，失败进入 fuzzy（whitespace 不一致触发 fallback）
🔴 [x] fuzzy Pass 1 (exact) — 精确匹配
🔴 [x] fuzzy Pass 7 (flexible_whitespace) — 单匹配成功
🔴 [x] fuzzy Pass 7 — 多匹配（matchAll > 1）→ 返回 null
🔴 [x] fuzzy 全部 pass 失败 → 返回错误
🔴 [x] 敏感文件拒绝 — known_hosts、.env、私钥等
🔴 [x] stale-read — 编辑前 detect stale，stale 时返回 {isError: true} 提示 re-read
🟡 [ ] 并发 edit — 不同文件的 edit 可并行执行
🟡 [ ] 极端文件 — 单行 1MB（无换行符）→ fuzzy pass 降级处理
🟡 [ ] 极端文件 — 10 万行 → hash-edit 流式处理不超 500ms
🟢 [x] 空 old_string → 返回 null
🟢 [x] 空 new_string → 相当于删除 old_string
```

### 2.4 bash

```
🔴 [x] 简单命令（echo hello）→ stdout + exitCode=0
🔴 [x] 命令返回非零 → 不抛异常，exitCode≠0 + stderr
🔴 [x] cwd 相对路径 → resolve(ctx.cwd, args.cwd)
🔴 [ ] 超时 — 死循环 / sleep 60 → timeout_ms 后 SIGKILL（需真实等待）
🔴 [x] 危险命令拒绝 — rm -rf / / sudo / mkfs / dd if=/ / chmod -R 777 /
🔴 [x] 敏感文件拒绝 — 命令中含敏感路径（绝对路径检测已验证）
🔴 [x] 超大输出（>500K chars）→ 截断 + truncation notice
🟡 [ ] 子进程 exit 后 stdout 未完全消费 → 进程被回收，无僵尸
🟡 [ ] detached 子进程 — 主进程崩溃后子进程组存活（已知限制）
🟡 [x] 二进制输出 → hasBinaryEncoding warning
🟡 [x] stderr 单独捕获 → out.stderr 包含错误输出
🟢 [x] 空命令 → 返回错误
🟢 [x] env 变量注入 — PATH 等被保留
```

### 2.5 list_dir / grep / glob

```
🔴 [x] list_dir: 混合文件+目录 → name/type/size 正确
🔴 [x] list_dir: stat 失败 → type: "unknown"，不中断
🔴 [x] grep: 正则匹配 → 返回匹配行+上下文
🔴 [x] grep: 无匹配 → 返回空结果
🔴 [x] grep: include 过滤（*.ts）→ 只看匹配文件
🔴 [x] glob: **/*.ts 递归匹配 → 结果不超 MAX_RESULTS(100) 截断
🔴 [x] glob: 路径穿越保护 → realpath + startsWith 校验（/tmp 和 ../ 均拒绝）
🟡 [ ] glob: Bun.Glob 不可用 → fallback 或 error
🟡 [ ] grep: rg 不可用回退 grep → --include 参数兼容
🟢 [x] list_dir: 空目录 → 返回空数组
```

### 2.6 Task Manager + Task Tools

```
🔴 [x] TaskManager.create → 自动生成 id/createdAt/updatedAt
🔴 [ ] TaskManager 完整流程 — create → get → update → stop
🔴 [x] TaskManager.stop → status 设为 "cancelled"
🔴 [x] TaskManager 持久化 — 重启后任务仍存在
🔴 [x] TaskManager 损坏 JSON → 不崩溃，返回空列表（含空文件）
🔴 [x] TaskCreate 拒绝空 content
🔴 [x] TaskUpdate 不存在的 id → 返回错误
🔴 [x] TaskList 按 status 过滤（pending/in_progress/completed/cancelled）
🟡 [x] TaskManager 并发 — 多个任务同时创建不冲突
🟡 [x] TaskGet 不存在的 id → 返回 undefined+error message
🟢 [x] TaskList 空列表 → 返回空数组
```

### 2.7 WebFetch

```
🔴 [ ] 正常 HTTPS URL → 返回 content + bytes + code
🔴 [ ] HTTP URL → 自动升级 HTTPS
🔴 [x] URL 含 username:password → 拒绝
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
🔴 [x] create_cell — 追加 code/markdown cell，index=-1 追加末尾
🔴 [x] create_cell — 指定 index 插入
🔴 [x] update_cell — 更新指定 cell 的 source
🔴 [x] delete_cell — 删除指定 cell
🔴 [x] 文件不存在 → 返回错误
🔴 [x] 无效 JSON（非 .ipynb 格式）→ 返回错误
🟡 [x] index 越界 → 返回错误
🟡 [ ] 路径穿越保护
```

### 2.10 其余工具（统一规格）

```
🔴 [x] AskUserQuestion: 返回结构化 question + options
🔴 [x] PlanMode: enter/exit 返回对应信号
🔴 [x] Sleep: 0ms 立即返回 / 指定 ms 后返回 / >300s 被限制
🔴 [x] Sleep: AbortSignal 触发提前结束
🔴 [x] WebBrowser: navigate 返回页面内容 / screenshot 返回提示（validate: action/url 校验）
🟡 [x] WebBrowser: SSRF 保护（复用 web-fetch 的 isPrivateIP，只测了 action 校验；网络部分需 mock）
🔴 [x] Monitor: process/disk/memory/file 四模式各自返回结构（validate 校验 + abort 信号快速返回空 samples）
🟡 [x] Monitor: file 模式路径穿越保护（resolve 校验，无 realpath 验证）
🔴 [x] Worktree: 非 git 仓库返回错误
🔴 [x] Cron: create/delete/list 操作 crontab（parseJobs/deleteJob 纯函数；系统依赖跳过）
🔴 [x] Workflow: 多步骤有序执行 / 空 steps 返回错误
🔴 [x] AgentTool: 委托任务返回结果
🔴 [x] SendMessage: 发送消息返回结构化结果
🔴 [x] LSP: 返回 {status: "unavailable"}（stub）
🟡 [x] PushNotification: notify-send 不可用 → terminal bell 回退
🟡 [ ] Cron: crontab 文件不存在 → 自动创建
🟡 [x] Workflow: 步骤执行失败 → 返回错误结果继续执行后续
```

### 2.11 Sensitive / SafeStringify / StaleRead

```
🔴 [x] isSensitive(api-key)=true, isSensitive(src/index.ts)=false
🔴 [x] SENSITIVE_FILE_PATTERNS — .env.* / *.pem / *.key / 证书/ npmrc 全覆盖
🔴 [x] safeStringify 循环引用 → 不抛异常，返回 fallback
🔴 [x] safeStringify 超过 maxLen → 截断
🔴 [x] hasBinaryEncoding — � 占比 >5% → true
🔴 [x] stale-read recordRead → checkStale mtime 变化 → 返回 stale
🟡 [x] safeStringify BigInt / Symbol → 不抛异常，转 string 表示
🟡 [x] checkStale 从未 read 过的文件 → 返回 undefined（不误报）
```

---

## 3. Skills 系统

```
🔴 [x] SkillTool search — 按名称/描述/标签匹配，返回列表（matchSkills 单元 + loadSkillsDirs 集成）
🔴 [x] SkillTool search — 无匹配返回空（matchSkills 返回 []）
🟡 [x] SkillTool list — 列出所有已加载技能（loadSkillsDirs 加载多目录已覆盖；全量 52+ 需真实 skills 目录）
🟡 [x] SkillTool load — 返回指定技能的完整 SKILL.md 内容（validate: missing query ✅；文件加载在 skill-loader 测试中覆盖）
🔴 [ ] SkillTool load 不存在 → 返回错误
🟡 [ ] skill 排序 — 按 matching score 降序
🟡 [ ] 条件技能（paths frontmatter）— 不命中时不加载
```

---

## 4. MCP 包 (`packages/mcp/`)

### 4.1 McpClient

```
🔴 [ ] connect → initialize(2024-11-05) → 收到 protocolVersion → 发送 notifications/initialized（无 id）
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
🟢 [ ] disconnect → SIGTERM + _connected=false，不 reject pending（假设 server 正常退出）
```

### 4.2 McpHost

```
🔴 [ ] loadConfig — .deepicode/mcp.json 解析 servers 数组
🔴 [x] loadConfig — 配置文件不存在不报错，返回空
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
🔴 [x] McpAuth set → 返回 {status: "stored"}（validate: missing server/api_key ✅）
🔴 [x] McpAuth list → 返回空数组
```

---

## 5. Security 包 (`packages/security/`)

### 5.1 PermissionEngine

```
🔴 [x] exec tier 工具默认 ask / read+write tier 默认 allow
🔴 [x] deny 规则优先 — rm -rf 上 deny 规则，无论 allow 规则
🔴 [x] deny 规则按 tool name 精确匹配
🔴 [x] deny 规则按 tool name 正则匹配
🔴 [x] deny 规则按 args 模式匹配（如 cwd 包含 /etc）
🔴 [x] allow 规则放行 — 匹配 allow 规则的无需 ask
🔴 [x] 多规则冲突 — deny > allow > default
🟡 [ ] isAllowed / isDenied 快捷方法 — 等价于 decide().decision
🟡 [ ] 自定义规则从 JSON 加载
```

### 5.2 HookManager

```
🔴 [x] beforeToolCall — 返回 deny 阻止执行
🔴 [x] beforeToolCall — 返回 allow 放行
🔴 [x] beforeToolCall — 未注册 hook 返回 undefined（不影响）
🔴 [x] beforeToolCall — hook 抛异常 → 捕获后返回 deny（fail-safe）
🔴 [x] beforeToolCall — 多 hook 链，第一个返回 deny/allow 后不执行后续
🔴 [x] afterToolCall — 接收工具名和执行结果
🔴 [ ] afterToolCall — 抛异常不中断主流程
🟡 [x] onLoopEvent — 每个 loop 事件触发
🟡 [x] addHooks / removeHooks — 引用相等比较
🟢 [x] clear — 清空所有 hook
```

### 5.3 FileSnapshot

```
🔴 [x] snapshot → 保存原文件到 .deepicode_patches/{sha256}.snap
🔴 [x] revert → 从快照恢复原文件
🔴 [x] 同文件多次 snapshot → 保留最新快照
🔴 [x] revert 不存在的快照 → 不抛异常
🟡 [x] 目录不存在 → 自动创建 .deepicode_patches/
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
🔴 [ ] idle 双击 Ctrl+C → 第一次 StatusBar 提示 → 2s 内第二次退出
🔴 [ ] idle 单击超时 → 2s 后 exitTimer 自动清除，无状态残留
🔴 [ ] /exit 命令 → cleanupTerminal + process.exit(0)
🔴 [ ] exitOnCtrlC: false — Ink 不拦截 \x03
🟡 [ ] SIGINT+Bridge 竞态 — cancel 后 bridge finally 执行，状态一致
🟡 [ ] 多次快速 Ctrl+C — exitPending 防止重复 exit
```

---

## 7. 集成 / 压力 / 边界（🔴 最关键）

### 7.1 多轮工具链闭环

```
🔴 [ ] read → edit → read 验证 — 编辑后重读确认内容正确
🔴 [ ] bash("echo hello > /tmp/test.txt") → read("/tmp/test.txt") — 交叉验证
🔴 [ ] Task 完整流程 — Create → List → Get → Update(status→completed) → Stop
🔴 [ ] grep → edit — grep 找到位置作为 edit 的 old_string 锚点
🔴 [ ] 5 轮工具调用链 — 每轮依赖上一轮结果（read→edit→bash verify→grep→write）
```

### 7.2 错误恢复闭环

```
🔴 [ ] 工具返回 isError — 模型收到 [Error] 前缀 + 调整策略
🔴 [ ] 连续 2 次 stream 失败 — 自动重试，第三次失败终止
🔴 [ ] permission deny — 工具不被执行 + 模型收到拒绝信息
🔴 [ ] repair pipeline 失败 — 不触发 API 重试，tool 返回 error
```

### 7.3 压力 / 边界

```
🔴 [ ] 50 轮对话 — fold 触发 + 截断生效，响应时间不超过首轮的 2x
🔴 [ ] 1 字节 SSE chunk × 100000 — 不崩溃，正确重组
🔴 [ ] 半个 UTF-8 字符跨 chunk — 正确解码不丢字
🔴 [ ] 超长 JSON tool arguments（50K chars）— repair 不超时
🔴 [ ] 并发 submit 拒绝 — engine 返回错误而非崩溃
🔴 [ ] 10MB 文件 read_file — 截断 + notice，不 OOM
🟡 [ ] 100 个工具注册 — ToolRegistry.toToolSpecs 不超 10ms
🟡 [ ] 1000 行 JSONL session 恢复 — 加载时间 < 1s
🟢 [ ] 极端文件名（含空格 / Unicode / emoji）— 所有文件操作正常
```

### 7.4 安全

```
🔴 [x] bash 危险命令遍历 DENY_PATTERNS — 全部被拦截
🔴 [ ] bash 敏感文件 — cat .env / cat ~/.ssh/id_rsa 被拒绝
🔴 [x] read_file / write_file / edit 敏感路径 — .env / api-key / .git/ 被拒绝
🔴 [ ] web-fetch 内网 IP — 127.0.0.1 / 192.168.x.x / 10.x.x.x 被拒绝
🔴 [ ] glob / notebook-edit / monitor file 路径穿越 — realpath 校验
🟡 [ ] SQL 注入尝试 — bash 命令中含 '; DROP TABLE → 拒绝（不在 DENY_PATTERNS 中，但无害）
```

---

## 8. E2E Agent 驱动测试

由另一个 AI agent（如 Claude Code）通过 pipe 模式驱动 Deepicode，验证端到端行为。无需写断言代码——agent 用对话式验证替换精确匹配。

### 测试方式

```bash
echo "<自然语言prompt>" | bun run dev 2>&1
```

Agent 发 prompt，观察 Deepicode 的工具调用和输出，判断行为是否符合预期。

### 测试场景（11 个）

**场景 1：基础问答**
```
prompt: "1+1等于几？只回答数字。"
验证: 输出含 "2"，无工具调用
```

**场景 2：read_file**
```
prompt: "用 read_file 读取 packages/cli/src/tui.ts 的内容"
验证: 输出含 [tool] read_file，含 tui.ts 源码内容
```

**场景 3：bash**
```
prompt: "用 bash 执行 ls packages/core/src/ 列出所有文件"
验证: 输出含 [tool] bash，含 engine.ts / client.ts 等文件名
```

**场景 4：write_file + read 双工具链**
```
prompt: "用 write_file 创建 /tmp/deepicode-test.txt 内容为 'hello world'，然后用 read_file 读出来确认写入成功"
验证: 输出含 [tool] write_file 和 [tool] read_file，最终含 "hello world"
```

**场景 5：edit 编辑**
```
prompt: "用 edit 把 /tmp/deepicode-test.txt 中的 world 改成 deepicode，然后用 read_file 确认"
验证: 输出含 [tool] edit，read_file 结果含 "hello deepicode"
```

**场景 6：glob 文件匹配**
```
prompt: "用 glob 找出 packages/tools/src/ 下所有 .ts 文件"
验证: 输出含 [tool] glob，文件列表含 shell-exec.ts / hash-edit.ts 等
```

**场景 7：grep 搜索**
```
prompt: "用 grep 在 packages/core/src/ 下搜索 isToolUseFinishReason 函数定义"
验证: 输出含 [tool] grep，结果含 client.ts 或 loop.ts
```

**场景 8：错误恢复**
```
prompt: "用 read_file 读取 /tmp/deepicode_nonexistent_file_xyz.txt"
验证: 输出含错误信息（"File not found" 或 "error"），进程 exit code 0
```

**场景 9：多轮工具链（4 步）**
```
prompt: "做以下操作：1. write_file 创建 /tmp/deepicode-chain.txt 内容为 'step1'；2. edit 改为 'step2'；3. bash 执行 cat /tmp/deepicode-chain.txt 验证；4. read_file 最终确认"
验证: 依次出现 4 个 [tool]，最终输出含 "step2"
```

**场景 10：write_file 敏感路径拒绝**
```
prompt: "用 write_file 在当前目录创建 .env 文件，内容为 SECRET=123"
验证: 输出含 "sensitive" 或拒绝信息，文件未被创建
```

**场景 11：中文基础对话**
```
prompt: "你好，请简单介绍一下你自己能做什么"
验证: 输出含中文回复（"助手" / "代码" / "工具"），非空，exit code 0
```

### 验证标准

| 场景 | exit code | 关键验证 |
|------|-----------|---------|
| 1 | 0 | 输出含 "2" |
| 2 | 0 | 含 `[tool] read_file` + 文件内容 |
| 3 | 0 | 含 `[tool] bash` + 文件名 |
| 4 | 0 | 含 write + read 两个 tool + "hello world" |
| 5 | 0 | 含 edit tool + "hello deepicode" |
| 6 | 0 | 含 glob tool + .ts 文件列表 |
| 7 | 0 | 含 grep tool + 匹配结果 |
| 8 | 0 | 含错误信息但不崩溃 |
| 9 | 0 | 含 4 个 tool 调用 + "step2" |
| 10 | 0 | 含拒绝信息 |
| 11 | 0 | 含非空中文回复 |

---

## 运行方式

```bash
# 全体测试（216 tests, 24 files, 1.63s ✅）
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

# 运行标记为 integration 的测试（需要 mock server 预先启动）
bun test -- --integration

# 类型检查（0 errors ✅）
bun run typecheck

# 覆盖率报告
bun test --coverage
```

## 覆盖率目标

| 包 | 当前 | 短期目标 | 最终目标 |
|---|------|---------|---------|
| core | ~35% | 60% | 85% |
| tools | ~40% | 60% | 80% |
| security | ~30% | 50% | 80% |
| mcp | ~15% | 40% | 65% |
| skills | 0% | 30% | 50% |
| tui | 0% | 30% | 50%（手动为主） |
| cli | 0% | 30% | 50% |

## 实现顺序

1. **Mock 基础设施**（tests/helpers/）— 测试可执行的前提
2. **Core 包** 1.1~1.9（最高价值，最多行数）— 引擎正确性决定一切
3. **Tools 包** 2.1~2.4（核心工具：read/write/edit/bash）— 使用频率最高的工具
4. **Security 包** 5.1~5.3 — 安全底线
5. **MCP 包** 4.1~4.3 — 协议正确性
6. **Tools 包剩余** 2.5~2.11 — 辅助工具
7. **集成测试** 7.1~7.4 — 端到端闭环
8. **TUI + CLI** 6.1~6.2 — 手动为主，关键路径自动化
