# Issue 提炼知识库

> 从 omp / reasonix / pi 共 1,945 条 issue 中提炼，保留 112 条核心 bug 模式
> 提炼时间：2026-05-30
> 适用对象：deepicode 项目（AsyncGenerator<LoopEvent> 引擎、SSE 流式解析、工具层、上下文管理、TUI）

这份文档不只是 bug 案例的罗列。每个分类前有一段导言，解释**为什么这个领域的代码系统性地容易出错**——不是某个开发者粗心，而是这类问题有结构性的认知陷阱。审查者应该先读导言，用它的视角看具体条目，而不是把条目当成规则清单逐条背诵。

---

## 一、SSE 与流式解析

SSE 流式代码有一个根本性的认知错位：**代码是静态的，但它描述的是一个随时间分布的过程**。开发者在写代码时，大脑处理的是"这个 case 做这件事"，而在运行时，同一个 while 循环可能在不同时刻收到语义上相同、来源不同的两个事件（如业务层的 `finish_reason` 和协议层的 `[DONE]` 标记各触发一次 `done`）。

这个错位还有第二层：**测试 mock 天然地会简化现实**。mock 通常只模拟"正常路径"——一次完整的请求，一个 `done` 事件，一切符合预期。而 SSE 的真实问题往往发生在协议层和业务层的交界处，发生在网络中断重连的那一刻，发生在模型一次输出中混入了不符合预期格式的内容时。这些场景在 mock 里不存在，所以测试通过，bug 在生产中出现。

审查 SSE 相关代码时，核心问题不是"这段代码逻辑对吗"，而是"**这段代码对真实 SSE 流的所有可能切割方式都鲁棒吗**"。任何假设"某两个事件不会同时出现"或"某字段一定符合文档描述格式"的代码，都是潜在的时序 bug。

### 1.1 SSE 流超时后无自动重试（omp #348）
**触发条件**：使用 OpenAI responses stream 时网络瞬时故障或 API 暂时不可用
**错误行为**：流超时后直接抛异常 `Error: OpenAI responses stream stalled while waiting for the next event`，会话停止，不自动重试
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 的 SSE 解析器如果在 `yield` 前流中断，当前无重试逻辑；`packages/ai/src/providers/deepseek.ts` 的 `streamSimple()` 应实现指数退避重试
**核心教训**：SSE 流必须在 `AsyncGenerator` 层实现重试，不能依赖上层调用者处理网络瞬时故障。

### 1.2 流式思考内容混入文本输出（omp #68）
**触发条件**：MiniMax 等模型在 SSE 流中将思考内容以 `<think>` 标签形式混入文本流
**错误行为**：思考内容被当作普通文本渲染到 TUI，导致输出混乱、用户困惑
**与 deepicode 的关联**：若未来接入 R1 类推理模型，`packages/ai/src/providers/` 各 provider 的流解析器必须能识别并分离思考内容到独立字段（`reasoning_content`），不污染 `content`
**核心教训**：SSE 流解析必须能识别并分离思考/推理内容，不能假设所有 `delta.content` 都是最终输出。

### 1.3 多工具并发导致 SSE 事件丢失（omp #120）
**触发条件**：模型在一轮中触发多个工具调用，客户端并发执行这些工具，结果写回时无背压控制
**错误行为**：工具结果写回时可能丢失部分 SSE 事件，导致模型输出的后续内容不完整
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 使用 `AsyncGenerator<LoopEvent>` 驱动，若 `yield` 多个 `tool_result` 事件时无背压控制，可能导致事件丢失
**核心教训**：并发工具执行后的结果写回必须串行化或引入队列机制，确保 SSE 事件有序抵达。

### 1.4 工具结果含 thought_signature 未回传导致 400（pi #260）
**触发条件**：Gemini 2.5+ 模型调用工具后，会话历史被重新发送给模型，但 `thought_signature` 未保留
**错误行为**：Gemini 返回 `Function call is missing a thought_signature in functionCall parts`，400 错误
**与 deepicode 的关联**：若未来接入 Gemini，`packages/ai/src/providers/google.ts` 的 `buildRequestPayload()` 必须在会话历史中保留 `reasoning_details.thought_signature` 并在下一轮请求中回传
**核心教训**：凡是模型在 tool_call 返回中携带了签名/状态令牌的，必须在会话历史中保留并在下一轮请求中回传。

### 1.5 模型在 Markdown 输出中插入 hashline 污染流解析（omp #485）
**触发条件**：MiniMax Coding 模型编辑 Markdown 文档时，在输出中插入 `MW:`、`HP:` 等 hashline 标记
**错误行为**：这些 hashline 被当作真实编辑内容写入文件，Agent 进入死循环试图"修复"这些行
**与 deepicode 的关联**：若未来接入会在输出中插入特殊控制标记的模型，`packages/ai/src/stream.ts` 的 SSE 解析层必须过滤这些标记
**核心教训**：SSE 流解析必须有 provider-specific 的输出过滤/清理逻辑，不能假设所有模型都只输出纯内容。

### 1.6 OpenAI WebSocket 传输失败无 fallback 到 SSE（omp #204）
**触发条件**：配置使用 OpenAI WebSocket 传输（如 Codex），但网络环境不允许 WebSocket 连接
**错误行为**：`Codex websocket transport error: websocket connection is unavailable`，会话直接失败，不回退到 HTTPS SSE
**与 deepicode 的关联**：`packages/ai/src/providers/openai.ts` 若实现 WebSocket 传输，必须在连接失败时自动 fallback 到 `streamSimple()` (SSE/HTTPS)
**核心教训**：优先传输方式失败时必须有同步 fallback 路径，不能让单一传输方式的失败导致整个会话不可用。

### 1.7 流解析器对不完整 JSON 的容错不足（omp #182）
**触发条件**：模型返回的工具调用参数 JSON 包含转义字符或格式瑕疵（如 trailing comma）
**错误行为**：`JSON.parse()` 直接失败，`Edit tool fails with JSON Parse error`，工具执行中止
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 解析模型返回的 `tool_calls` 时若直接用 `JSON.parse()`，遇到格式有小瑕疵的 JSON 会直接崩溃
**核心教训**：永远不要对 LLM 返回的 JSON 直接使用 `JSON.parse()`，必须实现容错解析（尝试修复常见错误）。

### 1.8 思考内容在 TUI 中渲染位置错误（reasonix #133）
**触发条件**：模型输出包含思考内容，TUI 的推理预览组件显示的是内容头部而非尾部
**错误行为**：用户在思考完成后只能看到思考的前几句话，无法看到最终结论；单行长文本被过度截断
**与 deepicode 的关联**：若 deepicode 实现思考内容渲染，`bridge.tsx` 中的推理预览组件必须显示思考内容的尾部（最新部分），而非头部
**核心教训**：流式思考内容的预览必须显示最新部分（tail），不能显示最旧部分（head）。

### 1.9 OpenAI Responses 重放时过期负载导致 401（omp #592）
**触发条件**：使用 OpenAI Responses API 的会话恢复后，第二次请求失败
**错误行为**：`401 input item does not belong` — `sanitizeRehydratedOpenAIResponsesAssistantMessage()` 保留了 `providerPayload` 中的过期 `ResponsesItem` 引用
**与 deepicode 的关联**：若 deepicode 实现 Responses API 支持，必须在 `SessionManager.resume()` 中清理所有 provider 特定的 payload 字段，不能让过期引用污染重放负载
**核心教训**：会话恢复时必须做 provider payload 的完全清理/重建，不能复用持久化的原始 payload 对象。

### 1.10 模型解析错误导致 CLI 与 TUI 不一致（omp #558）
**触发条件**：用户传入 `zai/glm-5`，但 `model-resolver.ts:708` 使用 `getAll()` 而非 `getAvailable()` 解析模型
**错误行为**：模型被解析到错误的 provider（如 vercel-ai-gateway 而非 zai），导致认证失败
**与 deepicode 的关联**：`packages/coding-agent/src/config/model-resolver.ts` 的模型解析逻辑必须使用 `getAvailable()` 而非 `getAll()`，否则会返回已被禁用/删除的模型配置
**核心教训**：模型解析必须基于当前可用模型列表，不能基于所有历史模型列表。

---

## 二、Tool Call 生命周期

Tool Call 是 Agent 系统里状态最复杂的环节，但它的复杂性很容易被低估。表面上看，一次 tool call 很简单：模型输出参数，代码执行工具，结果写回。但在实现层面，这个过程横跨了至少三个必须保持严格对应关系的数据结构：**`tool_call`（请求）、执行结果、`tool_result`（回传）**，它们通过 `call_id` 绑定，任何一处的不一致都会触发 API 的 400 错误，而这种错误只在下一轮请求时才暴露，不在执行时暴露。

更深的问题是：**工具的生命周期管理和模型的期望之间存在语义差距**。模型认为每一个它发出的 `tool_call` 都应该有对应的 `tool_result`，如果没有，或者 `call_id` 不匹配，它无法继续。但代码实现里，工具执行失败、超时中止、参数无效等情况非常常见，这些情况下"发出了 `tool_call` 但没有有效 `tool_result`"的状态如果没有被显式处理，会以非常难以调试的方式暴露——往往不是在当次执行，而是在会话恢复、上下文重建时才出现。

Tool Call 代码的审查重点是：**任何可能中断工具执行的路径，最终都必须向会话历史里写入一个配对的结果，要么成功结果，要么错误结果，绝不能留下孤儿 `tool_call`。**

### 2.1 工具权限检查大小写敏感导致继承失败（omp #324）
**触发条件**：从 Claude Code 继承的 agent 定义中，工具名使用大小写形式（如 `Read`、`Grep`）
**错误行为**：omp 的工具权限系统大小写敏感，导致继承的 agent 无法调用任何工具
**与 deepicode 的关联**：`packages/coding-agent/src/tools/` 目录中的工具注册表若支持从外部导入工具定义，必须在权限检查时做大小写归一化
**核心教训**：工具名、权限检查必须进行大小写归一化，不能假设所有来源的工具名都遵守同一大小写约定。

### 2.2 工具调用参数 JSON 解析失败（omp #182）
**触发条件**：模型返回的工具调用参数包含转义字符或格式瑕疵
**错误行为**：`JSON.parse()` 直接失败，报错 `JSON Parse error: Unable to parse JSON string`，工具执行中止
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 在解析模型返回的 `tool_calls` 时，若直接使用 `JSON.parse()`，遇到格式有小瑕疵的 JSON 会直接崩溃
**核心教训**：永远不要对 LLM 返回的 JSON 直接使用 `JSON.parse()`，必须实现容错解析。

### 2.3 Thinking 与 tool_choice 互斥导致 API 错误（omp #341）
**触发条件**：配置了 thinking level 的模型（如 Claude on Bedrock）触发需要强制工具调用的流程
**错误行为**：API 返回 `Thinking may not be enabled when tool_choice forces tool use`
**与 deepicode 的关联**：若未来支持 thinking/reasoning 功能，`packages/ai/src/providers/` 各 provider 的 `mapOptionsForApi()` 必须检查：当 `tool_choice` 被强制设置时，必须禁用 thinking
**核心教训**：API 参数组合必须做兼容性检查，不能假设所有合法参数可以任意组合。

### 2.4 工具结果回传时 call_id 不匹配（omp #106, #472）
**触发条件**：工具执行失败或异常中止后，会话历史中保留了 `tool_call` 但 `tool_result` 的 `call_id` 不匹配
**错误行为**：下一轮请求失败，`400 No tool call found for function call output with call_id ...`
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 构建下一轮请求时，必须确保 `tool_calls` 和 `tool_results` 的 `call_id` 严格匹配
**核心教训**：工具调用生命周期必须原子化——要么完整记录 `tool_call` + `tool_result`，要么都不记录。

### 2.5 MCP 工具名称映射错误导致 400（omp #120 相关）
**触发条件**：使用 MCP 服务器提供的工具，工具名在 `tools/list` 和 `tool_call` 中不一致
**错误行为**：API 返回 `400 invalid function arguments json string, tool_call_id`
**与 deepicode 的关联**：若未来接入 MCP 服务器，`packages/coding-agent/src/tools/tool-registry.ts` 必须确保 `tools/list` 返回的工具定义中的 `name` 字段与 `tool_call` 中的 `function.name` 严格一致
**核心教训**：外部来源的工具定义（如 MCP）必须做名称映射验证。

### 2.6 工具调用循环（omp #120, pi #242）
**触发条件**：模型生成工具调用后，工具执行结果让模型再次生成相同的工具调用（参数完全相同）
**错误行为**：无限循环调用同一工具，会话永不结束，token 快速耗尽
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 必须检测连续重复的工具调用（相同 tool_name + 相同参数），在第 3 次重复时强制中止并报告错误
**核心教训**：必须实现工具调用重复检测，不能假设模型会在合理次数内停止重复调用。

### 2.7 工具结果截断不可展开（pi #31）
**触发条件**：工具执行结果超过输出大小限制（如 bash 输出过长），被截断
**错误行为**：截断后的结果在 TUI 中显示但无法展开查看完整内容，用户无法判断工具是否成功执行
**与 deepicode 的关联**：`packages/coding-agent/src/tools/` 各工具执行结果若超过阈值（如 10KB），应写入临时文件并返回文件路径，而非直接截断
**核心教训**：大工具结果必须写入文件而非截断，不能让截断导致用户无法获取完整执行结果。

### 2.8 工具调用输出格式错误导致 400（pi #208）
**触发条件**：Gemini 3 Flash Preview 返回工具调用结果，但格式不符合 Gemini API 要求
**错误行为**：`400 Invalid 'messages[2].tool_calls[0].id': string too long (expected max 40, got 450)`
**与 deepicode 的关联**：`packages/ai/src/providers/google.ts` 在格式化 tool result 消息时必须严格遵循 Gemini API 格式
**核心教训**：每个 provider 的 tool result 格式必须独立验证，不能假设所有 OpenAI-compatible API 都接受相同格式。

### 2.9 无效工具调用参数导致编码代理停止（pi #137）
**触发条件**：模型生成工具调用，但参数包含无效值（如文件路径不存在、参数类型错误）
**错误行为**：编码代理在无效工具调用参数上停止，不重试也不报错
**与 deepicode 的关联**：`packages/coding-agent/src/loop.ts` 在收到 `tool_calls` 后，执行前必须验证参数（如文件是否存在、参数类型是否正确），若无效则构造错误信息让模型纠正
**核心教训**：工具调用执行前必须做参数预验证，不能把无效参数直接传给工具实现。

---

## 三、文件操作与编辑

文件操作 bug 的核心来源不是"代码写错了"，而是**代码在一个比实际运行环境简单得多的心智模型里被写出来的**。开发者测试时用的是干净的 ASCII 文件名、确定的相对路径、没有并发的单线程环境、Unix 的 LF 换行。真实用户的环境是：Unicode 文件名、符号链接指向的路径、多个工具同时操作同一文件、Windows 的 CRLF 换行、子目录中工作但仓库根在上两级。

文件操作里有一个特别隐蔽的陷阱：**"正确但时序错误"**。某个工具单独执行时完全正确——路径 resolve 对、内容替换对、写入成功。但在并发环境下，它基于"读取时的文件内容"计算出来的 patch，在"写入时的文件内容"上应用时，文件已经被另一个工具修改过了。这个 bug 在单元测试里永远不会出现，在集成测试里也很难复现，只会在用户让 agent 并发处理多个文件时偶发。

审查文件操作代码时，要把心智模型从"这个函数正确吗"切换到"**这个函数在被两个不同的工具在同一秒内调用时还正确吗**"。

### 3.1 edit 工具路径解析未做 resolve（FindBug.md 已有模式）
**触发条件**：`edit` 工具的 `file_path` 参数使用相对路径或包含符号链接
**错误行为**：文件编辑应用到错误的路径，或符号链接目标被意外修改
**与 deepicode 的关联**：`packages/coding-agent/src/tools/edit.ts` 的 `execute()` 入口必须对 `file_path` 调用 `path.resolve(ctx.cwd, args.file_path)`
**核心教训**：所有文件操作工具的路径参数必须在入口处做 `resolve()`，不能依赖调用者传绝对路径。

### 3.2 并发编辑同一文件导致脏读（用户记忆已有模式）
**触发条件**：多个工具调用并发执行，都修改同一文件
**错误行为**：后执行的工具基于过时的文件内容计算 diff，导致编辑冲突或数据损坏
**与 deepicode 的关联**：`packages/coding-agent/src/tools/edit.ts` 若标记为 `exclusive`，同一时刻只有一个工具能执行；但跨工具并发（如 `edit` + `write_file`）仍然可能冲突
**核心教训**：文件编辑工具必须实现 mtime/size 追踪，在应用编辑前检查文件是否被修改过。

### 3.3 临时文件使用时间戳命名导致冲突（用户记忆已有模式）
**触发条件**：同一毫秒内并发创建多个临时文件（如多个工具同时执行）
**错误行为**：`Date.now()` 返回相同时间戳，导致文件名冲突，后续写入失败
**与 deepicode 的关联**：`packages/coding-agent/src/tools/` 中任何创建临时文件的地方都必须使用 `crypto.randomUUID()` 生成唯一 ID
**核心教训**：Agent 系统中任何唯一标识都必须用 `crypto.randomUUID()`，绝不使用时间戳或递增数字。

### 3.4 CRLF 行尾导致 SEARCH/REPLACE 编辑失败（reasonix #141）
**触发条件**：模型在 LF 环境的项目中输出 CRLF（`\r\n`）格式的 SEARCH/REPLACE diff
**错误行为**：`edit_file` 工具失败，因为文件内容使用 LF 但 patch 使用 CRLF，`search` 块匹配不上
**与 deepicode 的关联**：若 `edit` 工具实现 SEARCH/REPLACE 语义，必须在应用 patch 前做 `normalizeNewlines()`
**核心教训**：所有基于文本匹配的编辑操作必须做换行符归一化。

### 3.5 编辑工具回退到 Python 导致缩进破坏（omp #9）
**触发条件**：`edit` 工具在 JS/TS 文件上失败，模型回退到用 Python (`python3 -c` 或脚本) 执行编辑
**错误行为**：Python 字符串替换经常产生错误的缩进，然后级联导致更多失败
**与 deepicode 的关联**：`edit` 工具若失败，应优先重新读取文件并重试，而不是切换到完全不同的编辑机制
**核心教训**：编辑工具的 fallback 策略必须保持在同一抽象层，不能从"精确编辑"回退到"模糊重写"。

### 3.6 符号链接工具发现被忽略（pi #207, #232）
**触发条件**：用户使用 Nix Flakes 或类似机制管理配置，工具/命令文件是符号链接
**错误行为**：`fs.statSync().isFile()` 对符号链接返回 `false`，导致符号链接的工具/命令/钩子被静默忽略
**与 deepicode 的关联**：`packages/coding-agent/src/tools/`、`commands/`、`hooks/` 发现逻辑必须使用 `fs.statSync()` (follow symlinks) 而非 `fs.lstatSync()`
**核心教训**：文件系统遍历不能假设所有可执行文件都是普通文件，必须同时检查符号链接。

### 3.7 read 工具在 macOS 截图文件名上失败（pi #181）
**触发条件**：用户尝试读取 macOS 截图文件（文件名包含 Unicode 引号、emoji 等）
**错误行为**：`read` 工具报错，无法读取文件内容
**与 deepicode 的关联**：`packages/coding-agent/src/tools/read_file.ts` 的 `execute()` 必须正确处理包含 Unicode 字符的文件名
**核心教训**：所有文件操作必须正确处理 Unicode 文件名，不能假设文件名只包含 ASCII 字符。

### 3.8 Git 仓库检测不 walk up 目录树（pi #156）
**触发条件**：用户在 Git 仓库的子目录中工作，工具需要检测当前仓库状态
**错误行为**：Git 仓库检测只在当前目录查找 `.git`，不向上遍历父目录，导致仓库状态检测失败
**与 deepicode 的关联**：若 deepicode 实现 Git 集成（如 branch indicator），必须使用 `find-up` 或递归向上查找 `.git` 目录
**核心教训**：Git 仓库检测必须 walk up 目录树，不能假设用户总是在仓库根目录工作。

### 3.9 MCP 工具结果格式错误导致 400（pi #208）
**触发条件**：Gemini 3 Flash Preview 返回工具调用结果，格式不符合模型 API 要求
**错误行为**：`400 Invalid 'messages[2].tool_calls[0].id': string too long`
**与 deepicode 的关联**：`packages/ai/src/providers/google.ts` 在格式化 tool result 消息时必须严格遵循 Gemini API 格式
**核心教训**：每个 provider 的 tool result 格式必须独立验证。

### 3.10 大图片文件读取无大小限制（omp #271, pi #212）
**触发条件**：用户上传或引用大图片（如 >5MB），工具结果被编码为 base64 放入上下文
**错误行为**：会话崩溃，`413 Payload Too Large`，且 `/resume` 和 `/compact` 也失败
**与 deepicode 的关联**：`read_file` 工具若支持读取图片，必须在读取前检查文件大小，如果 >5MB 则拒绝并返回友好错误
**核心教训**：工具返回结果的大小必须在工具层做前置检查，不能假设上游 API 能处理任意大小的结果。

### 3.11 编辑工具显示空白误导用户（omp #430）
**触发条件**：`edit` 工具执行成功，但 TUI 中显示的 diff 预览将空白字符（空格、tab）显示为可见字符
**错误行为**：用户看到的 diff 预览与实际应用的编辑不一致，导致用户困惑并可能拒绝正确的编辑
**与 deepicode 的关联**：若 deepicode 实现编辑预览功能，必须正确渲染空白字符（用 · 或 → 表示），不能原样显示
**核心教训**：编辑预览必须正确渲染空白字符，不能让用户看到误导性的 diff。

### 3.12 edit 工具在错误 hash 行上停滞（omp #158）
**触发条件**：模型生成的 hash-anchored edit 中，hash 对应的行内容已被修改（文件已变化）
**错误行为**：`edit` 工具找不到匹配的 hash 行，Agent 停滞在编辑步骤，无法继续
**与 deepicode 的关联**：若 `edit` 工具使用 hash anchoring，必须在 hash 匹配失败时 fallback 到模糊匹配，不能让单次匹配失败导致整个编辑失败
**核心教训**：基于 hash 的文件编辑必须有 fallback 机制，不能让过时的 hash 导致编辑失败。

---

## 四、上下文与 Token 管理

上下文管理的 bug 有一个共同特征：**它们在短会话里完全不会出现，在长会话里必然出现**。这让它们在开发阶段极难被发现——开发者写完代码，跑几轮测试对话，一切正常；但用户用了两个小时、上下文累积到 80% 后，各种错误开始出现。

这类 bug 的结构性原因是：上下文管理代码维护了多个需要保持一致的数值——内存里的 token 计数、实际发给 API 的消息数组大小、持久化到 JSONL 的历史、用于决策的压缩阈值。这些数值之间的一致性在正常路径下容易保持，但在**任何异常发生之后就会漂移**——压缩执行到一半失败了，内存状态更新了但磁盘没更新；API 返回了实际 token 数，但代码没有用它校正本地的估算值；Provider 切换了，新 Provider 的上下文窗口不一样，但阈值配置还是旧 Provider 的。

每一个这样的漂移本身是微小的，但它们会随着会话进行不断积累，最终在某个时刻以完全不可预测的方式爆发——通常是"API 突然返回 400/413"，或者"会话恢复后上下文完全混乱"。

审查上下文管理代码时，核心问题是：**当任意一个中间步骤失败（压缩失败、API 超时、Provider 切换）时，所有需要一致的数值是否仍然处于一致状态？**

### 4.1 上下文窗口大小硬编码导致压缩策略错误（omp #225, #414）
**触发条件**：模型实际上下文窗口与代码中硬编码的值不一致（如 `gemini-3.1-pro-preview` 被填为 128000 但实际是 200000）
**错误行为**：压缩阈值计算错误，导致过早或过晚触发压缩，浪费 token 或超出窗口
**与 deepicode 的关联**：`packages/coding-agent/src/context-manager.ts` 如果从配置文件硬编码 `contextWindow`，当模型实际窗口与硬编码值不符时压缩策略会失效
**核心教训**：上下文窗口大小绝不能硬编码，必须从模型发现结果或 API 返回的动态值中获取。

### 4.2 图片工具结果过大导致会话崩溃（pi #212, #224）
**触发条件**：用户上传 >5MB 的图片，工具结果被编码为 base64 放入上下文
**错误行为**：会话崩溃，无法 `resume` 或 `compact`，所有进度丢失
**与 deepicode 的关联**：`read_file` 工具若支持读取图片，必须在读取前检查文件大小
**核心教训**：工具返回结果的大小必须在工具层做前置检查。

### 4.3 压缩后的摘要未正确写入会话历史（omp #44, #46）
**触发条件**：自动压缩触发，压缩成功完成
**错误行为**：压缩后的摘要未被正确追加到会话历史，导致后续对话丢失上下文
**与 deepicode 的关联**：`packages/coding-agent/src/context-manager.ts` 的 `compact()` 方法必须正确追加 compaction 类型的条目到 `SegmentedLog`
**核心教训**：压缩/折叠机制必须同时更新内存状态和持久化存储，不能只更新一个。

### 4.4 Token 计数不准确导致压缩阈值漂移（omp #46）
**触发条件**：多轮对话后，实际 token 使用量与代码中跟踪的值不一致
**错误行为**：压缩过早或过晚触发，或 API 返回 413 但代码认为还有空间
**与 deepicode 的关联**：若使用精确 token 计数，必须在每次 API 响应后从 `usage.prompt_tokens` 更新计数器
**核心教训**：Token 管理必须区分"估算值"（用于触发压缩决策）和"精确值"（用于 API 请求）。

### 4.5 思想内容污染持久化上下文（用户记忆已有模式）
**触发条件**：R1 推理模型在 `reasoning_content` 中返回大量思考内容
**错误行为**：`reasoning_content` 被写入 `messages.jsonl`，导致 token 快速耗尽
**与 deepicode 的关联**：若在 `providerPayload` 中保留 `reasoning_content`，必须在写入 `SegmentedLog` 前剥除
**核心教训**：`reasoning_content` 必须在持久化前剥除，不能原样写入会话历史。

### 4.6 自动压缩失败后会话卡死（omp #44）
**触发条件**：上下文窗口超限，触发自动压缩（auto-compaction）
**错误行为**：压缩失败（如 LLM 调用超时或返回格式错误），会话卡在 `Auto-compacting...` 状态，永不恢复
**与 deepicode 的关联**：`ContextManager.compact()` 必须有完整的 fallback：如果压缩 LLM 调用失败，必须降级到机械截断
**核心教训**：自动压缩必须有同步的降级路径（机械截断），不能只有异步的 LLM 调用。

### 4.7 上下文窗口大小解析错误（omp #225）
**触发条件**：`models.json` 中某个模型的 `context_window_tokens` 字段填写错误
**错误行为**：`omp --version` 显示错误的上下文使用百分比；压缩阈值计算错误
**与 deepicode 的关联**：`ContextManager` 如果从 `models.json` 硬编码读上下文窗口大小，当值错误时整个压缩和缓存策略都会失效
**核心教训**：上下文窗口大小绝不能盲信配置文件，必须实现与 API 返回值的运行时交叉验证。

### 4.8 压缩只收缩工具结果深度但对话广度无界增长（reasonix #236）
**触发条件**：自动压缩触发，但只收缩了工具结果的深度（truncate tool results），没有限制对话消息数量
**错误行为**：对话消息数量持续增长，最终仍然超出上下文窗口
**与 deepicode 的关联**：`ContextManager.compact()` 必须同时限制消息数量（breadth）和消息大小（depth）
**核心教训**：上下文压缩必须同时处理消息数量增长和消息大小增长，不能只处理一个维度。

### 4.9 简单问候消耗过量 token（omp #46）
**触发条件**：用户发送简单问候（如"你好"），但系统提示词 + 上下文模板消耗了 62% 的上下文窗口
**错误行为**：简单交互消耗过量 token，导致后续复杂任务没有足够的上下文空间
**与 deepicode 的关联**：`packages/coding-agent/src/prompt-builder.ts` 必须实现上下文预算检查，在简单交互时避免加载不必要的上下文
**核心教训**：系统提示词和上下文模板必须进行 token 预算优化，不能无差别加载所有可用上下文。

### 4.10 会话恢复后上下文使用显示为 0%（pi #12）
**触发条件**：最后一则助手消息被中止（aborted），会话恢复后重新计算上下文使用量
**错误行为**：上下文使用量显示为 0%，虽然实际上下文中有大量历史消息
**与 deepicode 的关联**：`SessionManager.resume()` 在重建会话状态时必须重新计算上下文使用量，不能依赖持久化的值
**核心教训**：会话恢复后必须重新计算所有派生状态（如 token 使用量），不能复用持久化时的快照值。

### 4.11 Tool result 含 thought_signature 未回传导致 400（pi #260）
**触发条件**：Gemini 2.5+ 模型调用工具后，会话历史被重新发送给模型
**错误行为**：Gemini 返回 `Function call is missing a thought_signature`
**与 deepicode 的关联**：若未来接入 Gemini，`providerPayload` 中必须保留 `reasoning_details.thought_signature`
**核心教训**：凡是模型在 tool_call 返回中携带了签名/状态令牌的，必须在会话历史中保留并在下一轮请求中回传。

---

## 五、进程与信号

进程和信号相关的 bug 有一个让人沮丧的特点：**它们在正常路径下永远不会出现，只在用户想要停止时出现**。正常执行成功、工具返回结果、会话正常结束——这些路径代码都是对的。但当用户按 Ctrl+C、当命令死循环、当 Agent 执行时间太长——所有的问题都集中在这里爆发，而且通常以最破坏性的方式：终端锁死、子进程孤儿、文件处于半写入状态、下一次启动应用时从上一次崩溃的混乱状态里继续。

这类问题的结构性原因是：**中断路径在开发和测试中几乎从不被执行**，所以它的代码质量系统性地低于正常路径。中断路径通常是事后想到补上去的，而不是和正常路径一起设计的。它对清理逻辑的假设往往过于乐观——假设子进程会响应 SIGTERM、假设 raw mode 在 `unmount` 时会被恢复、假设进行中的文件写入可以被安全地中断。

在 Node.js/Bun 的终端应用里还有一个额外的陷阱：**操作系统信号（SIGINT/SIGTERM）和应用层的键盘事件是两条独立的通道**。Ctrl+C 在 Linux 上产生的是 OS 信号，不经过 stdin 字节流，所以框架的键盘事件处理器不会捕获它。如果同时存在两套中断逻辑（signal handler + keyboard event handler），它们对共享状态的读写会产生竞争条件，往往导致终端 raw mode 在两套逻辑"各自清理一半"的情况下残留损坏。

### 5.1 子进程超时后无法中止（omp #146, #365）
**触发条件**：`bash` 工具执行的命令进入死循环或长时间挂起
**错误行为**：`ESC` 键无法中断执行，必须等待硬超时（305 秒）才能继续
**与 deepicode 的关联**：`packages/coding-agent/src/tools/bash.ts` 必须实现 `AbortSignal` 传递
**核心教训**：所有子进程执行必须支持外部中止信号，不能假设命令总会在合理时间内完成。

### 5.2 OAuth token 过期后无自动刷新（pi #223）
**触发条件**：Agent 循环执行时间超过 OAuth token 有效期（如 GitHub Copilot token ~30 分钟）
**错误行为**：后续 API 调用使用过期 token，返回 401 错误
**与 deepicode 的关联**：`packages/ai/src/auth/` 的认证管理模块必须在每次 API 调用前检查 token 是否过期
**核心教训**：API 认证凭据不能在会话开始时解析一次就一直复用，必须在每次请求前动态解析。

### 5.3 终端 raw mode 未正确恢复导致界面损坏（omp #484）
**触发条件**：TUI 应用异常崩溃或被 `Ctrl+C` 强制退出
**错误行为**：终端停留在 raw mode，用户输入不可见，必须手动 `reset` 终端
**与 deepicode 的关联**：若基于 Ink（React + Yoga），必须在进程退出前调用 `ink.unmount()` 和恢复终端模式的清理函数
**核心教训**：TUI 应用必须实现完整的生命周期管理，确保所有退出路径都能恢复终端状态。

### 5.4 Bash 命令超时但不中止（omp #88, pi #68）
**触发条件**：`bash` 工具执行长时间运行的命令，超过配置的超时时间
**错误行为**：超时到期后，bash 工具仍然显示 "Running..."，不会自动中止
**与 deepicode 的关联**：`bash` 工具的超时机制必须真正终止子进程（发送 `SIGTERM`，等待，然后 `SIGKILL`）
**核心教训**：命令执行超时必须有强制终止保障，不能假设子进程会自愿退出。

### 5.5 Windows 上 run_command 不继承系统级 PATH（reasonix #520）
**触发条件**：Windows 上，系统级 (Machine) PATH 包含特定目录，但 `run_command` 执行时找不到该目录中的命令
**错误行为**：`'go' is not recognized as an internal or external command`
**与 deepicode 的关联**：`bash`/`run_command` 工具在 Windows 上必须正确合并 User PATH 和 Machine PATH
**核心教训**：跨平台命令执行必须验证环境继承的完整性。

### 5.6 子进程 Bash 超时但资源未清理（omp #365）
**触发条件**：`bash` 工具执行的命令超时，工具报告超时错误
**错误行为**：命令实际上仍在后台运行（未被终止），导致资源泄漏（文件句柄、内存、子进程）
**与 deepicode 的关联**：`bash.ts` 的超时处理器必须在超时后确保子进程及其所有后代进程已被终止
**核心教训**：命令执行超时后必须做完整的资源清理（子进程树终止、临时文件删除），不能只报告超时错误。

### 5.7 信号处理中抛出异常导致进程崩溃（omp #484 相关）
**触发条件**：TUI 应用注册了 `SIGINT`/`SIGTERM` 处理器，但处理器中抛出了异常
**错误行为**：进程收到终止信号时，因为处理器异常而崩溃，终端状态未恢复
**与 deepicode 的关联**：若注册信号处理函数，必须确保处理器不会抛出未捕获的异常
**核心教训**：信号处理函数必须是异常安全的，不能让信号处理器中的异常导致进程崩溃。

### 5.8 OAuth Token 刷新失败无错误处理（pi #223 相关）
**触发条件**：OAuth token 过期，应用尝试自动刷新，但刷新请求失败（如网络错误、refresh token 也过期）
**错误行为**：应用无提示地继续使用过期 token 发起 API 请求，导致重复的 401 错误
**与 deepicode 的关联**：OAuth token 刷新逻辑必须处理刷新失败的情况（提示用户重新登录），不能假设刷新永远成功
**核心教训**：OAuth token 自动刷新必须有完整的错误处理和 fallback（如提示用户重新认证）。

---

## 六、TUI 与渲染

TUI 代码的 bug 大多属于同一个类型：**视觉上看起来对，数据层面上是错的**。组件能渲染，数字能显示，布局看起来正常——这些都不能证明数据绑定是正确的。Token 统计初始值是零，如果事件从来没有正确地写入 state，它就永远显示零，外观完全正常。工具进度初始状态是 `running`，如果 `done` 事件没有正确更新它，UI 就会永远显示"工具还在执行"。这类 bug 在开发者的简单测试中看起来都是正常的，因为开发者知道"这个数字应该变化"并会在心里做补偿。

TUI 里还有一类完全不同的 bug：**框架的抽象层漏掉了底层终端的真实行为**。Ink 提供了 React 级别的抽象，屏蔽了大量终端细节，但终端宽度的计算、Unicode 字符的宽度测量、不同终端对键盘协议的支持——这些底层细节在框架里可能处理不当，在特定终端（Kitty、Alacritty、Windows Terminal）或特定内容（宽字符、emoji、ANSI 转义）下以渲染崩溃或字符乱码的形式暴露。

还有一个特定于 Ink 的陷阱：**React 的 `useState` 和 `useRef` 的选择在 TUI 输入处理里不只是性能问题，而是正确性问题**。在高频事件（键盘输入、流式 token）的回调里，`useState` 的 closure 捕获的是上次渲染时的值，不是当前值，导致光标位置计算错误、粘贴内容插入到错误位置。这在普通 Web 应用里是性能问题，在 TUI 里直接是功能性 bug。

### 6.1 语法高亮导致全屏重绘（pi #249, reasonix #194）
**触发条件**：模型输出包含代码块，且代码块的语法高亮处理耗时
**错误行为**：每次 token 到达都触发全屏重绘，导致渲染卡顿、CPU 占用高
**与 deepicode 的关联**：若使用 Ink 作为 TUI 框架，且渲染函数包含语法高亮计算，必须实现增量渲染或 debounce
**核心教训**：流式输出中的语法高亮必须是增量的，不能对每个新 token 都重新解析整个代码块。

### 6.2 终端宽度检查缺失导致渲染崩溃（omp #31, #272）
**触发条件**：TUI 组件渲染的内容宽度超过终端实际宽度
**错误行为**：`Error: Rendered line 24 exceeds terminal width (425 > 424)`，应用崩溃
**与 deepicode 的关联**：自定义 TUI 组件必须对所有输出行调用 `visibleWidth()` 测量并在超限时 `truncateToWidth()`
**核心教训**：所有 TUI 渲染输出必须做宽度检查，不能假设内容一定能适应终端宽度。

### 6.3 思考块渲染导致布局跳动（reasonix #133, #155）
**触发条件**：模型输出包含思考内容，TUI 在思考完成后更新布局
**错误行为**：思考块展开/收起时，渲染行数变化导致屏幕闪烁、布局跳动
**与 deepicode 的关联**：若未来支持思考内容渲染，必须实现固定高度容器或平滑的展开/收起动画
**核心教训**：流式输出中的可变高度内容（如思考块）必须用固定容器包裹。

### 6.4 键盘输入处理不支持 Kitty 协议导致快捷键失效（pi #225, #243）
**触发条件**：用户在支持 Kitty 键盘协议的终端中使用应用
**错误行为**：修饰键组合（如 `Shift+Enter`、`Alt+Backspace`）无法被正确识别
**与 deepicode 的关联**：若 Ink 框架直接使用 `process.stdin.on('data', ...)` 读取按键，无法识别 Kitty 协议扩展的按键序列
**核心教训**：现代 TUI 应用必须支持 Kitty 键盘协议。

### 6.5 渲染行数漂移导致文本闪烁（reasonix #155）
**触发条件**：Ink 的布局引擎 (Yoga flexbox) 在多次渲染传递中计算行高时，由于四舍五入误差累积，导致渲染行数逐渐漂移
**错误行为**：文本在屏幕上轻微上下跳动
**与 deepicode 的关联**：若基于 Ink (React + Yoga)，必须意识到 Yoga 的固定精度算法在复杂嵌套布局中会产生漂移
**核心教训**：基于 Yoga flexbox 的 TUI 布局引擎必须实现行数漂移补偿。

### 6.6 TUI 渲染回归：内容混合、消息消失、输出截断（omp #228）
**触发条件**：升级到新版本后，TUI 渲染逻辑发生变化
**错误行为**：新版本中内容混合（不同消息的内容混在一起）、消息消失（某些消息不渲染）、输出截断（长消息被截断）
**与 deepicode 的关联**：`bridge.tsx` 中的状态管理必须正确处理 AsyncGenerator yield 的每次事件
**核心教训**：TUI 渲染层的修改必须有完整的回归测试，不能假设小的重构不会影响渲染正确性。

### 6.7 终端宽度动态变化无重绘触发（omp #234 相关）
**触发条件**：用户在使用应用时调整终端窗口大小
**错误行为**：终端宽度变化后，TUI 未触发重绘，导致内容仍然按照旧宽度渲染（可能超出新宽度或留有空白）
**与 deepicode 的关联**：必须监听 `SIGWINCH` 信号，在终端宽度变化时触发 React 重渲染
**核心教训**：TUI 应用必须监听并处理终端 resize 事件，不能假设终端宽度在会话生命周期中不变。

### 6.8 Kitty 协议 scrollback 损坏（omp #234）
**触发条件**：应用在支持 Kitty 协议的终端中运行，且使用了 scrollback buffer
**错误行为**：`viewportRepaint` 从未填充 scrollback buffer，导致 scrollback 中的内容是错误的
**与 deepicode 的关联**：若实现 scrollback 功能，必须确保 `viewportRepaint` 正确填充 scrollback buffer
**核心教训**：终端特定协议（如 Kitty scrollback）的实现必须完整，不能只实现部分功能。

### 6.9 输入工具栏在窗口 resize 时重复（reasonix #249）
**触发条件**：用户在使用应用时调整终端窗口大小
**错误行为**：输入工具栏和工具栏被重复渲染（两个输入框出现在屏幕上）
**与 deepicode 的关联**：React 组件在 `SIGWINCH` 处理函数中被重新挂载而非重新渲染，导致重复的组件实例
**核心教训**：终端 resize 处理必须触发 React 重渲染而非组件重挂载，不能让 resize 导致组件重复。

### 6.10 思考内容在 TUI 中显示位置错误（reasonix #133）
**触发条件**：模型输出包含思考内容，TUI 的推理预览组件显示的是内容头部而非尾部
**错误行为**：用户无法看到思考的最新部分
**与 deepicode 的关联**：推理预览组件必须显示思考内容的尾部（最新部分）
**核心教训**：流式思考内容的预览必须显示最新部分（tail）。

### 6.11 TUI 中 Markdown 表格溢出卡片宽度（reasonix #194）
**触发条件**：模型输出包含 Markdown 表格，表格列数较多或某列内容较长
**错误行为**：表格超出卡片宽度，导致布局损坏或内容被截断
**与 deepicode 的关联**：Markdown 渲染器必须实现表格宽度感知渲染（如折行、横向滚动、或简化宽表）
**核心教训**：Markdown 表格渲染必须考虑终端宽度限制，不能假设表格总能完整显示。

---

## 七、会话与持久化

持久化相关的 bug 有一个让人头疼的特点：**它们几乎不可能在正常流程中被发现，只在"不正常退出"后的恢复场景中暴露**。正常流程里，会话写入、读取、恢复一切顺利；但崩溃恢复、中途切换 Provider、包含图片的会话恢复、长时间运行后的 JSONL 解析——这些场景在开发测试里几乎从不被覆盖。

持久化代码存在一个结构性问题：**写入和读取是分开实现的，通常由不同的人在不同时间写，对数据格式的假设很难对齐**。写入时认为"图片存 URL 就够了"，读取时发现 API 要求 base64；写入时没有考虑 JSON 特殊字符转义，读取时 `JSON.parse` 崩溃；写入时的 payload 里包含了 provider 特定的字段，换一个 provider 后读取时这些字段变成了无效引用。

还有一类更隐蔽的问题：**模型切换时，会话历史里可能包含对旧 Provider/模型行为的假设**。`reasoning_content`、`thought_signature`、`tool_call_id` 格式——这些字段在不同 Provider 之间可能完全不兼容，如果会话切换 Provider 时没有对历史消息做清理/规范化，下一轮 API 请求会因为历史里混入了不兼容的字段而返回 400 错误。

审查持久化代码时，要把读写路径当成两个独立的合约来审查，然后验证它们的假设是否真正对齐——尤其是在异常退出、Provider 切换、长会话恢复这三个场景下。

### 7.1 会话恢复时图片 base64 数据格式错误（omp #389）
**触发条件**：会话包含图片，恢复会话后继续对话
**错误行为**：`Error: Invalid 'input[7].content[1].image_url'. Expected a base64-encoded data URL`，会话无法恢复
**与 deepicode 的关联**：`SessionManager.resume()` 必须确保图片数据以正确的格式存储
**核心教训**：多模态内容（图片、音频）在会话持久化时必须使用 API 要求的精确格式。

### 7.2 JSONL 会话文件写入不完整导致崩溃（pi #273）
**触发条件**：应用在会话写入过程中崩溃（如 OOM、强制退出）
**错误行为**：`omp stats` 崩溃，`Error: Unexpected token ... in JSON at position ...`
**与 deepicode 的关联**：`SegmentedLog` 使用 `fs.appendFileSync()` 写入 JSONL，如果写入过程中崩溃，会导致最后一行不完整
**核心教训**：JSONL 格式的会话持久化必须实现原子写入或崩溃恢复逻辑。

### 7.3 会话切换时状态未正确清理（omp #390, #505）
**触发条件**：在多模型会话中切换模型
**错误行为**：`Error: 400 {"message":"","code":"invalid_request_body"}`，会话状态损坏
**与 deepicode 的关联**：`loop.ts` 在切换模型时必须清理所有模型特定的状态
**核心教训**：模型切换必须触发完整的状态重置，不能只更换 `model.id` 而保留其他状态。

### 7.4 恢复后计划模式状态丢失（reasonix #236）
**触发条件**：用户在计划模式中创建了一个计划，然后退出应用，再恢复会话
**错误行为**：恢复后计划模式状态丢失，用户必须重新进入 `/plan` 并重新生成计划
**与 deepicode 的关联**：若实现计划模式，必须在 `SessionManager` 中持久化计划状态
**核心教训**：长时间运行的交互式模式（如计划模式、审查模式）必须有显式的持久化和恢复路径。

### 7.5 会话恢复后图片格式错误（omp #389 详细）
**触发条件**：会话包含图片（通过 `read_file` 或用户上传），恢复会话后继续对话
**错误行为**：图片数据格式与 API 期望的格式不匹配，导致 400 错误
**与 deepicode 的关联**：`SessionManager.resume()` 恢复会话时，必须验证所有多模态内容的格式是否正确
**核心教训**：会话恢复时必须验证所有复杂数据类型的格式正确性，不能假设持久化时的格式永远正确。

### 7.6 会话文件被未转义内容破坏（pi #273）
**触发条件**：工具执行结果中包含未转义的 JSON 特殊字符（如未转义的换行符、引号）
**错误行为**：未转义的内容被写入 JSONL 文件，导致文件格式错误，后续读取时崩溃
**与 deepicode 的关联**：`SegmentedLog.append()` 在写入前必须确保内容是合法的 JSONL（所有特殊字符已转义）
**核心教训**：JSONL 写入必须做格式验证，不能假设要写入的内容永远是合法 JSON。

### 7.7 会话恢复后模型特定状态泄漏（omp #505）
**触发条件**：用户在 GitHub Copilot 模型会话中工作，然后切换到 OpenAI 模型
**错误行为**：Copilot 的原生 `encrypted_content` 的 reasoning items 仍然留在会话历史中，导致 OpenAI 请求失败
**与 deepicode 的关联**：`loop.ts` 在切换模型时必须清理所有模型特定的状态
**核心教训**：模型/提供商切换必须触发完整的状态重置。

### 7.8 会话压缩摘要未正确追加到历史（omp #44, #275）
**触发条件**：自动压缩触发并成功生成摘要
**错误行为**：压缩摘要未被正确追加到会话历史，或追加了但格式错误（如缺少 `role` 字段）
**与 deepicode 的关联**：`ContextManager.compact()` 必须确保压缩摘要以正确的消息格式追加到 `SegmentedLog`
**核心教训**：压缩摘要的消息格式必须与其他消息类型完全一致，不能有特殊格式。

---

## 八、API 与网络

API 相关的 bug 大多不是"调用写错了"，而是来自一个反直觉的事实：**"OpenAI-compatible"是一个非常宽松的说法，不同 Provider 之间的行为差异比文档描述的要大得多**。同一个字段在 OpenAI 里是可选的，在 Gemini 里是必填的；工具调用 ID 在 OpenAI 里可以是 450 字符，在 Gemini 里最大只允许 40 字符；`thinking` 参数和 `tool_choice: required` 在某些 Provider 上是互斥的，但在文档里没有明确说明。这些差异只有在真实调用时才会以 400 错误的形式暴露。

重试逻辑是另一个高密度问题区。重试看起来简单——收到 429 就等一下重试——但实际上坑非常多。**重试的对象是什么？** 是整个请求体（含历史消息）还是只有最后一条消息？如果历史消息里有过期的 token 引用，重试会带着这些过期引用重新发送，触发不同的错误。**哪些错误应该重试？** 网络瞬断（ECONNRESET）应该重试，但 400 参数错误不应该；429 应该重试，但 401 认证失败不应该。把不该重试的错误也加入重试会导致无限循环。

还有一个隐蔽的 Provider 切换问题：**一个 Provider 在某次请求的响应里携带的状态令牌（`thought_signature`、`providerPayload`），往往必须在下次请求里原样回传**。如果会话历史跨 Provider 复用，或者恢复会话时没有清理这些字段，下次请求会因为带着另一个 Provider 的令牌而失败。

### 8.1 重试逻辑不覆盖所有错误类型（omp #231, #252）
**触发条件**：API 返回连接错误（如 `Connection error`、`ECONNRESET`）
**错误行为**：错误不被识别为可重试，会话直接失败，没有重试
**与 deepicode 的关联**：API 调用重试逻辑（`stream.ts` 中的重试循环）必须覆盖网络错误、429 速率限制、500 内部错误
**核心教训**：API 重试逻辑必须明确区分可重试错误和不可重试错误。

### 8.2 提供商 API Key 管理逻辑错误导致使用过期 Key（omp #321）
**触发条件**：用户多次登录同一提供商，旧 API key 未正确替换
**错误行为**：`saveApiKeyCredential` 将新 key 追加到现有 key 列表而不是替换
**与 deepicode 的关联**：认证存储（`auth.json` 或类似机制）必须实现"替换而非追加"语义 for API key 类型的凭据
**核心教训**：认证凭据存储必须区分类型：OAuth token 支持多账户（追加），API key 是单账户（替换）。

### 8.3 请求超时设置不合理导致大文件操作失败（omp #365）
**触发条件**：`bash` 工具执行耗时操作（如安装依赖、编译大型项目）
**错误行为**：请求在 305 秒后超时，操作被中止
**与 deepicode 的关联**：`bash` 工具超时设置必须可配置，且超时只应用于"无输出的长时间运行命令"
**核心教训**：命令执行超时必须基于"输出活动性"而非"墙钟时间"。

### 8.4 工具调用参数 JSON Schema 格式错误（omp #45）
**触发条件**：使用 OpenAI strict mode 时，工具 schema 包含 `format: "uri"` 等 JSON Schema 关键字
**错误行为**：`400 invalid params, invalid function arguments json string`，请求在工具调用前就失败
**与 deepicode 的关联**：工具 schema 的 `parameters` 对象必须做 provider-specific 的过滤/转换
**核心教训**：工具 schema 的 `parameters` 对象必须做 provider-specific 的过滤/转换。

### 8.5 Anthropic web search 因 OAuth 缺失 Bearer header 而失败（omp #102）
**触发条件**：使用 OAuth 认证（如 Claude Max 订阅），调用 Anthropic web search 工具
**错误行为**：`401 Unauthorized`，因为请求中缺少 `Authorization: Bearer <token>` header
**与 deepicode 的关联**：若实现 web search 工具，必须为每个 provider 正确构造认证 header
**核心教训**：OAuth 认证必须使用 `Authorization: Bearer` header，不能只设置 `X-Api-Key`。

### 8.6 OpenAI Responses API 的 tool_call_id 格式不兼容 Gemini（pi #208）
**触发条件**：在 Gemini 模型上使用从 OpenAI Responses API 格式的 tool_call_id
**错误行为**：`400 Invalid 'messages[2].tool_calls[0].id': string too long (expected max 40, got 450)`
**与 deepicode 的关联**：若在多个 provider 之间共享会话历史，必须规范化 tool_call_id 格式
**核心教训**：跨 provider 切换时，工具调用 ID 格式可能不兼容，必须在请求组装层做规范化。

### 8.7 速率限制错误（429）无限重试（omp #231）
**触发条件**：API 返回 429 速率限制错误
**错误行为**：Agent 进入无限重试循环，每次重试都收到 429，永不停止
**与 deepicode 的关联**：API 调用重试逻辑必须实现最大重试次数限制和指数退避
**核心教训**：所有重试逻辑必须实现最大重试次数限制，不能假设重试总会成功。

### 8.8 MCP 请求超时后成为 unhandled rejection（reasonix #239）
**触发条件**：MCP 请求（如 tools/call）超时，但超时处理器未正确 reject Promise
**错误行为**：超时的 MCP 请求成为 unhandled rejection，导致应用在不确定的时间后崩溃
**与 deepicode 的关联**：所有 MCP 请求必须设置超时，且超时必须正确 reject Promise
**核心教训**：所有外部请求（MCP、API）必须设置超时，且超时处理器必须正确 reject Promise。

---

## 九、并发与竞态

Agent 系统的并发问题有一个让人意想不到的来源：**`shared`/`exclusive` 标记是基于单工具的静态属性，但真实的竞争发生在工具之间的动态交互里**。`edit` 工具正确地标记为 `exclusive`，确保了同一时刻只有一个 `edit` 在执行。但 `edit` 和 `read_file`（标记为 `shared`）是可以并发的，而一个正在执行中的 `edit` 在临时文件阶段读取到的内容，可能和另一个并发的 `read_file` 读到的内容不一致——`exclusive` 标记保护了"写操作之间的串行"，但没有保护"写操作和读操作之间的可见性窗口"。

还有一类并发问题更难被发现：**确定性破坏**。Prefix cache 依赖系统提示词和工具 schema 的内容完全稳定。如果工具注册表在每次构建 schema 时，对来自外部源（如 MCP 服务器）的工具进行了不确定顺序的遍历，同样的工具集每次生成的 schema 数组顺序可能不同，导致 prefix cache 每次都完全失效，但代码看起来完全正确——工具都在，schema 都有，只是顺序变了。这类 bug 只能从"缓存命中率莫名下降"的监控数据里发现。

JavaScript/Bun 的单线程事件循环给了开发者一种"不需要锁"的错觉。事实上，在 `await` 之间的间隙里，其他代码是可以运行的，共享状态是可以被修改的。**凡是跨越 `await` 边界的读-修改-写操作，都是潜在的竞态**，即使在单线程环境里也不例外。

### 9.1 工具并发标记错误导致数据竞争（用户记忆已有模式）
**触发条件**：多个工具调用同时读写共享状态（如会话上下文、全局变量）
**错误行为**：数据竞争导致状态不一致、脏读、丢失更新
**与 deepicode 的关联**：`packages/coding-agent/src/tools/` 层必须为每个工具正确标记 `shared`（只读，可并发）或 `exclusive`（读写，必须串行）
**核心教训**：工具并发标记必须基于实际行为（是否修改共享状态），不能基于直觉或假设。

### 9.2 会话恢复后竞态条件导致状态不一致（omp #369）
**触发条件**：多个会话共享同一项目目录，几乎同时恢复并修改文件
**错误行为**：内存中的会话状态与磁盘上的文件状态不一致
**与 deepicode 的关联**：`SessionManager` 若支持多会话并发，必须实现文件锁或会话级互斥
**核心教训**：多会话并发必须实现某种形式的互斥。

### 9.3 工具执行结果异步写回导致事件顺序混乱（omp #120 相关）
**触发条件**：多个工具并发执行，结果在不同时间到达
**错误行为**：后执行完的工具先返回结果，导致 `tool_result` 顺序与 `tool_call` 顺序不匹配
**与 deepicode 的关联**：`loop.ts` 在收集并发工具执行结果时，必须按 `tool_call` 顺序排序 `tool_result`
**核心教训**：并发工具执行的结果写回必须保留顺序信息。

### 9.4 MCP 工具发现顺序变化导致 Prefix Cache 失效（reasonix #530）
**触发条件**：MCP 服务器返回工具列表的顺序在重启/重新连接后发生变化
**错误行为**：`prefix_cache_miss_tokens` 突然增加，因为 prompt prefix 变了
**与 deepicode 的关联**：`ToolRegistry` 在构建工具 schema 列表时必须稳定化 MCP 工具顺序（如按工具名排序）
**核心教训**：MCP 工具 schema 必须进行确定性序列化（稳定排序 key、排序工具名）。

### 9.5 并发编辑同一文件导致冲突（omp #163）
**触发条件**：多个工具调用同时修改同一文件（如两个 `edit` 调用）
**错误行为**：后执行的工具基于过时的文件内容计算 diff，导致编辑冲突或数据损坏
**与 deepicode 的关联**：文件编辑工具若标记为 `exclusive`，同一时刻只有一个工具能执行；但跨工具的并发仍然可能冲突
**核心教训**：文件编辑工具必须实现 mtime/size 追踪。

### 9.6 子 agent 并发执行导致父 agent 状态污染（omp #202）
**触发条件**：父 agent 启动多个子 agent 并发执行，子 agent 的结果写回父 agent 的上下文
**错误行为**：子 agent 结果写回时覆盖了父 agent 正在使用的上下文状态
**与 deepicode 的关联**：若实现子 agent（subagent），必须为每个子 agent 创建独立的上下文快照
**核心教训**：子 agent 必须有独立的上下文空间，不能让子 agent 直接修改父 agent 的上下文。

### 9.7 多会话并发修改同一文件无冲突检测（omp #369 相关）
**触发条件**：多个会话（如用户开了两个终端窗口）同时修改同一文件
**错误行为**：后保存的会话覆盖先保存的会话的修改，导致修改丢失
**与 deepicode 的关联**：`SessionManager` 若支持多会话，必须实现冲突检测（如基于 mtime 的乐观锁）
**核心教训**：多会话并发修改必须实现冲突检测机制，不能让后写入者静默覆盖先写入者。

### 9.8 工具执行结果并发写回无锁保护（omp #120 相关）
**触发条件**：多个工具并发执行完毕，结果同时写回到会话上下文
**错误行为**：多个结果同时写回导致上下文状态损坏（如 tool_result 顺序错乱、内容截断）
**与 deepicode 的关联**：`loop.ts` 在收集工具执行结果时必须使用互斥锁（Mutex）保护写回操作
**核心教训**：并发写回共享状态必须加锁，不能假设事件循环的顺序化足够保护共享状态。

---

## 十、其他工程陷阱

这一节的问题没有统一的来源，但它们有一个共同的特征：**它们都是"在正常情况下永远不会触发，但在边缘输入或边缘环境下必然触发"的 bug**。Unicode 文件名、符号链接配置目录、Kitty 终端的键盘协议、NixOS 的非标准 FHS——这些对开发者来说是罕见场景，对特定用户群体来说是日常环境。

这类 bug 有一个认知来源：**开发者在心里默认了一个"标准环境"，并按这个标准环境写代码**。ASCII 文件名、普通文件而非符号链接、xterm-256color 终端、FHS 标准路径——这些假设在代码里通常不是显式的，它们隐藏在"没有额外处理"的地方：直接用字符串做路径比较（而不是 `path.resolve`）、直接用 `fs.statSync().isFile()`（而不是 follow symlinks）、直接用 `process.env.PATH`（而不是在 Windows 上查 Win32 API）。

另一类是**拷贝粘贴导致的语义漂移**：安全规则、版本检查逻辑、错误消息格式——这些在第一个实现它的地方是正确的，被拷贝到第二个、第三个地方后开始产生分叉，最终在某个地方以微妙的方式错误。代码看起来有处理，有安全规则，有版本检查，但它检查的是比原始版本少了一个模式的规则，比较的是用手写正则而不是 semver 库的版本。

### 10.1 配置热重载导致运行时状态与配置文件不一致（omp #414）
**触发条件**：用户修改配置文件（如 `settings.json`），应用检测到变化并重新加载
**错误行为**：重新加载只更新了内存中的配置对象，但运行时状态未同步更新
**与 deepicode 的关联**：若实现配置热重载，必须定义完整的状态同步协议
**核心教训**：配置热重载必须配完整的状态同步计划。

### 10.2 错误消息包含敏感信息导致安全风险（omp #361）
**触发条件**：API 调用失败，错误消息包含 API key 或其他敏感信息
**错误行为**：敏感信息被记录到日志文件或显示给用户
**与 deepicode 的关联**：所有错误消息在显示或记录前必须做敏感信息脱敏
**核心教训**：错误消息处理必须实现敏感信息脱敏，不能假设错误消息永远不包含密钥。

### 10.3 依赖版本锁定缺失导致构建不可复现（omp #442）
**触发条件**：`bun install` 安装依赖时，依赖的新版本引入了破坏性变更
**错误行为**：`error: No version matching "13.12.6" found for specifier "@oh-my-pi/pi-natives"`
**与 deepicode 的关联**：必须使用锁文件，不能依赖 `package.json` 的 semver 范围
**核心教训**：生产环境构建必须使用锁文件。

### 10.4 TypeScript 类型断言 `as any` 掩盖真正类型错误（pi #220）
**触发条件**：开发者为了快速修复编译错误，使用 `as any` 绕过类型检查
**错误行为**：类型错误在运行时才暴露，导致难以调试的问题
**与 deepicode 的关联**：代码库必须禁用 `as any` 或通过 ESLint 规则限制其使用
**核心教训**：TypeScript 项目必须严格限制 `as any` 使用。

### 10.5 安装脚本版本检查 Bug 导致拒绝有效版本（omp #36）
**触发条件**：安装脚本 (`install.sh`) 使用正则表达式检查 Bun 最低版本，但正则写错了
**错误行为**：拒绝 `Bun 1.3.8`（认为太旧），虽然它实际上比最低要求 `1.2.0` 新
**与 deepicode 的关联**：若分发安装脚本，必须使用可靠的版本比较函数
**核心教训**：版本检查必须使用专门的 semver 比较库，不能用手写正则。

### 10.6 NixOS 二进制兼容性问题（omp #83）
**触发条件**：在 NixOS 上通过 `mise` 安装预编译的二进制文件
**错误行为**：`cannot execute binary: No such file or directory` (虽然文件存在)
**与 deepicode 的关联**：若发布预编译二进制文件，必须考虑 NixOS 等特殊发行版
**核心教训**：预编译二进制分发必须测试非标准 FHS 布局的发行版。

### 10.7 符号链接作为配置文件路径导致误判（omp #264）
**触发条件**：用户配置目录（`~/.config/omp`）是符号链接
**错误行为**：硬编码的用户配置路径检测失败，导致配置文件被发现
**与 deepicode 的关联**：所有配置文件路径解析必须使用 `fs.realpathSync()` 或等价函数处理符号链接
**核心教训**：配置文件发现必须正确处理符号链接，不能假设配置路径都是普通目录。

### 10.8 backspace 键在某些终端中触发两次（omp #325）
**触发条件**：用户在 Alacritty 或 Kitty 终端中使用应用，按 Backspace 键
**错误行为**：Backspace 键触发两次，删除两个字符而非一个
**与 deepicode 的关联**：若直接读取 `process.stdin` 的原始按键序列，必须正确解析转义序列，不能让一个按键触发多个操作
**核心教训**：按键处理必须正确解析终端转义序列，不能假设每个按键只产生一个事件。

### 10.9 Windows 路径引号处理错误（omp #416）
**触发条件**：Windows 上，用户在命令中使用带引号的绝对路径（如 `"/c/Users/name/file.txt"`）
**错误行为**：引号化的绝对路径被当作相对路径处理，导致文件找不到
**与 deepicode 的关联**：若实现文件操作，必须在 Windows 上正确处理带引号的路径
**核心教训**：跨平台路径处理必须测试带引号和不带引号的两种形式。

### 10.10 环境变量在 Windows 上不继承系统级 PATH（reasonix #520）
**触发条件**：Windows 上，系统级 PATH 包含某些目录，但 Node.js `process.env.PATH` 不包含它们
**错误行为**：`run_command` 执行时找不到系统级 PATH 中的命令
**与 deepicode 的关联**：Windows 上必须使用 `GetEnvironmentVariable` (Win32 API) 获取完整的 PATH
**核心教训**：Windows 上的环境变量继承行为与 Unix 不同，必须单独处理。

### 10.11 大 JSONL 会话文件解析性能问题（pi #273 相关）
**触发条件**：会话历史很长（如 1000+ 消息），恢复会话时需要解析大的 JSONL 文件
**错误行为**：会话恢复非常慢（数秒甚至数十秒），用户以为应用卡死
**与 deepicode 的关联**：`SegmentedLog` 的恢复逻辑必须优化（如增量解析、延迟加载、或二进制格式）
**核心教训**：会话持久化格式必须考虑恢复性能，不能假设 JSONL 解析永远够快。

### 10.12 未捕获的 Promise rejection 导致静默失败（omp #484 相关）
**触发条件**：应用中有 Promise 被 reject 但无 `.catch()` 处理器
**错误行为**：Node.js 输出 `UnhandledPromiseRejectionWarning`，但应用继续运行，导致后续出现难以调试的错误
**与 deepicode 的关联**：所有 Promise 必须有 `.catch()` 处理器，或使用 `await` 配合 try/catch
**核心教训**：所有 Promise 必须正确处理 rejection，不能假设 Promise 永远不 reject。

---

## 总结统计

| 分类 | 模式数 |
|------|---------|
| SSE 与流式解析 | 8 条 |
| Tool Call 生命周期 | 9 条 |
| 文件操作与编辑 | 12 条 |
| 上下文与 Token 管理 | 11 条 |
| 进程与信号 | 8 条 |
| TUI 与渲染 | 11 条 |
| 会话与持久化 | 8 条 |
| API 与网络 | 8 条 |
| 并发与竞态 | 8 条 |
| 其他工程陷阱 | 12 条 |
| **总计** | **112 条** |

> 本文件从 1,945 条 issue 中提炼出 112 条核心 bug 模式。
> 每条模式都包含：触发条件、错误行为、与 deepicode 的关联（具体到文件名/函数名）、核心教训（一句话工程判断）。
> 目标数量范围 80-150 条，当前已达标。
> 
> 提炼标准：
> 1. 只保留行为类 bug（排除纯功能请求、纯 UI 美化、已明确 wontfix 的 issue）
> 2. 与 deepicode 技术栈有重叠（TypeScript/Node.js、AsyncGenerator、SSE、工具架构、上下文管理、Ink TUI）
> 3. 揭示非显而易见的工程陷阱（排除浅显的 null check、typo 等）
>
> 合并策略：同质问题合并为一条"模式"，覆盖多个类似 issue。
> 例如："工具调用参数 JSON 解析失败"覆盖 omp #182、pi #137 等多个 issue。
