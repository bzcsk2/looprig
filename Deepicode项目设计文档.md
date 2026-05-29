# deepicode 架构设计文档

---

## 一、项目概述

### 1.1 项目名称与定位

**deepicode** 是一个以 DeepSeek 为核心推理引擎、以极致性能和极低成本为目标的终端原生 AI 编程 Agent。该项目融合了流式工具执行（Streaming Tool Execution）、AST 级意图解析、异步流式大文件处理等生产级特性，旨在为开发者提供一个高速、低成本、稳定且可扩展的终端编程助手。

项目的核心设计理念是**"核壳分离"**——`deepicode-core` 引擎作为"核"负责推理与 API 交互优化，`deepicode-shell` 基础设施作为"壳"负责 TUI 渲染、工具管理和用户交互，两者通过清晰的事件接口解耦。这种架构使得引擎层可以独立迭代优化（如 cache 策略、token 计数），而壳层可以独立扩展功能（如新工具、新前端），互不干扰。
### 1.2 核心目标

项目围绕四大核心目标展开设计与实现：

1. **速度**：每轮响应时间减少 30-50%。这一目标通过 Streaming Tool Executor（模型输出时即启动工具）、分级 Tokenizer Worker Pool（增量旁路 + 异步卸载）以及后台预测性 Fold（上下文压缩不阻塞主流程）三大机制协同实现。

2. **成本**：非 Fold 轮次最大化 prefix-cache 命中率，Fold 后自动建立新缓存基准。通过 `SegmentedLog` 管理缓存生命周期，通过 Tool-call repair 流水线避免因格式错误导致的二次计费，通过智能推理强度调节系统自动选择最经济的模型档位。长会话的实际 cache hit 率取决于 Fold 频率和对话增量，详见 §9.2。

3. **稳定性**：消除 TUI 卡顿、fold 假死、大文件 IO 阻塞等体验问题。彻底废弃同步读取操作，通过 Transform Stream 实现大文件 Hash 流式异步计算，确保 Node.js 主线程始终流畅响应（帧率 > 30fps）。

4. **扩展性**：支持多 Agent 角色、插件系统、未来多前端。通过集中式状态管理、Event Bus 发布订阅、Agent 配置化等设计，为后续功能扩展预留充分空间。

### 1.3 目标用户

- 使用 DeepSeek API 进行日常编程的开发者，尤其是对终端工具有偏好的用户群体
- 需要长会话（超过 50 轮）的复杂代码重构场景，如大型项目迁移、架构升级等
- 对 API 成本敏感的个人开发者或小团队，希望在保证质量的前提下最大化降低调用费用
- 需要同时进行代码分析与编写的全栈开发者，期望 Agent 能在"只读分析"和"可写构建"模式间灵活切换

---

## 二、架构设计

### 2.1 架构原则

项目遵循四项核心架构原则，贯穿所有层级的设计决策：

1. **核壳分离**：`deepicode-core`（核）与 `deepicode-shell`（壳）通过清晰接口解耦。核层只关心推理循环、API 调用和上下文管理，壳层只关心渲染、工具调度和用户交互。两者之间的唯一通信通道是 AsyncGenerator 事件流和 AgentState 状态快照。

2. **事件驱动**：核心 loop 使用 AsyncGenerator（拉模式），壳层使用 EventStream（推模式）。这种双模式设计使得核心层可以保持简洁的迭代式处理逻辑，而壳层可以灵活地将事件分发到 TUI、日志、插件等多个消费者。

3. **增量优化**：先让引擎在壳中跑起来，再逐步引入增强功能。每个 Phase 都有独立的验收标准，确保项目始终处于可运行状态，降低集成风险。

4. **DeepSeek-first，Provider 可插拔**：prefix-cache 等核心优化围绕 DeepSeek 设计，但 provider 层通过 `ChatClient` 接口抽象。支持预设（Zen 免费、Mimo 免费、DeepSeek 官方）和用户自定义 endpoint。切换 provider 不改变上层引擎逻辑。

### 2.2 总体架构

系统采用五层架构，自上而下依次为用户层、壳层、核层、工具层和安全层。每一层都有明确的职责边界和接口契约。

**用户层**是交互入口，包含 Terminal（Ink TUI）等。所有前端通过统一的 CoreEngine 接口与壳层交互，确保不同前端的行为一致性。

**壳层 (`deepicode-shell`)** 负责基础设施，包含 TUI 渲染引擎（Ink/React）、Event Bus（Pub/Sub 跨组件通信）、Plugin System（Hooks 扩展机制）和 Agent State Manager（集中状态管理，包含 Session、Stats、ReadTracker、Scratch 四个子模块）。

**核层 (`deepicode-core`)** 是推理引擎的核心，包含 CacheFirstLoop（AsyncGenerator 驱动的主循环）、DeepSeekClient（SSE 流式 API 客户端）、ContextManager（上下文管理，含 SegmentedLog、ImmutablePrefix、VolatileScratch、Token Counter Worker）和 StreamingToolExecutor（流式工具执行器，含 AST 级 Eager Dispatch、并发安全、状态机）。核层还集成了智能推理强度调节系统和 Token 用量预估系统（CNY Native）。

**工具层**是能力提供层，包含 File Ops、Shell Exec、Search/Grep、Edit/Hash（异步流式锚定编辑）、LSP Client、Web Fetch、MCP Client 和 Python Kernel 等 30+ 核心能力。

**安全层**是防护机制，包含 Deny-first Rule Engine（默认拒绝规则引擎）、System-level Bypass（死锁提权）、Hooks 和 Git Snapshot（变更追踪）。

### 2.3 分层职责总览

| 层级 | 职责 | 核心模块 | 关键技术 |
|------|------|---------|---------|
| 用户层 | 交互入口 | Terminal (Ink), CLI | Ink/React |
| 壳层 | 基础设施 | TUI 渲染、Event Bus、Agent State Manager | AsyncGenerator→EventStream |
| 核层 | 推理引擎 | CacheFirstLoop、DeepSeekClient、ContextManager、StrategySelector | SSE 流式、Prefix Cache、AST 局部解析、滑动 TPS |
| 工具层 | 能力提供 | File Ops、Shell、Search、Edit (Hash)、LSP、Web、MCP | 流式 Hash 计算、9-Pass Fuzzy |
| 安全层 | 防护机制 | Deny-first 权限、Hooks、Git Snapshot、系统级免检 | 局部单文件 Shadow Git、规则引擎 |

---

## 三、核心层设计

### 3.1 CacheFirstLoop（引擎心脏）

CacheFirstLoop 是整个系统的核心驱动引擎，采用 AsyncGenerator 模式实现，每轮用户输入触发一次 step 迭代，通过 yield 事件向壳层推送状态变化。

**核心状态**包含四个关键数据结构：
- **SegmentedLog**（分段日志）：替代原朴素 AppendOnlyLog。包含 `FoldedArchive`（已压缩归档区）和 `ActiveWindow`（活跃滑动窗口）。只有分段管理才能明确 Prefix Cache 的生命周期和刷新时机。
- **VolatileScratch**（易失性草稿区）：存储当前轮的临时数据，不发往 API。
- **SessionStats**（会话统计）：追踪 token 用量和 CNY 成本。
- **ReadTracker**（读取追踪器）：记录模型已读文件以支持 stale-read 检测。

**单轮执行流程**分为七个阶段：
1. **策略选择集成**：分析输入，输出 4 档位 CNY 估算对比，推送倒计时，确定模型（chat/reasoner）。
2. **预测性 Fold**：后台启动 Fold 操作（如果超出容量），异步进行。
3. **构建消息**：合并 ImmutablePrefix 与 SegmentedLog 的活跃区。
4. **API 流式调用**：发起 SSE 请求，实时解析文本、工具和推理（R1 reasoning_content）。
5. **流式处理与分级 Eager Dispatch**：读操作（`isConcurrencySafe=true`）buffer 完整即刻并发执行；写操作等 `finish_reason` 确认后执行。
6. **收集工具结果**：合并所有并行和串行工具结果，追加到 SegmentedLog。
7. **检查 Fold 结果与 Cache Miss 阵痛管理**：如果本轮完成后台 Fold，替换历史归档并立刻抛出 `status` 事件，通知 TUI 下一轮必将发生 Cache Miss。

### 3.2 StreamingToolExecutor（流式工具执行器）

打破"模型输出完毕→解析→执行→返回"串行模式，实现模型输出和工具调用的并行。

**分级 Eager Dispatch**：
不等模型完整输出所有 tool call，流式 buffer 中检测到完整 JSON 参数即启动调度。但**仅对读操作（`isConcurrencySafe=true`）执行 eager dispatch**——写操作（edit、write_file、bash）必须等完整 tool call 确认后再执行。

```
流式 buffer 检测到完整 JSON
  ↓
判断：该工具是 read 类（isConcurrencySafe=true）？
  ├── 是 → 立刻 Eager Dispatch
  │        最坏结果：误读一个文件（毫秒级，零成本，无损）
  │
  └── 否 → 等待完整 tool call（finish_reason）确认后再执行
            保守路径：确保不因假闭合误写/误删
```

**设计边界**：

| | 读操作 | 写操作 |
|--|--------|--------|
| 假闭合误触发代价 | 多读一个文件，零成本 | 误写/误删，不可逆 |
| 并发收益 | 高（读是最频繁工具，可并行） | 低（写本身 exclusive 串行） |
| 模型修正参数风险 | 无影响 | 致命（写到错误位置） |

这个边界把 Eager Dispatch 的收益最大化（读操作占总工具调用 90%+），同时把风险降到零（写操作一律走保守路径）。

**并发安全检查**：
- **Concurrency-safe（并发安全）**：读操作（如 read、grep）。可以与其他读操作无缝并行。
- **Exclusive（独占）**：写操作（如 write、bash）。必须串行执行，且需等待所有并发读操作归零。

### 3.3 ContextManager（上下文管理器）

**三段式上下文结构**：
- **ImmutablePrefix**：系统提示词 + 工具规格定义，永不变化。100% 触发前缀缓存。
- **SegmentedLog**：历史对话分段归档区和活跃区。
- **VolatileScratch**：本轮临时缓冲区。

**Token 计数阈值旁路优化 (Bypass Threshold)**：
- **短增量（新消息文本长度 < 2000 字符）**：直接在主线程执行近似的字符数估算（字符数 ÷ 2.5 ≈ token 数，混合中英文场景取经验系数），耗时 < 1ms，不启动 Worker 线程避免 IPC 开销。
- **长增量（≥ 2000 字符，如全量读文件、历史树加载）**：Offload 到 Tokenizer Worker 线程池进行精确 BPE 计数。
- 注：2000 字符为启发式经验阈值，具体值待 tokenizer 接入后用基准测试校准。中英文混合场景下，字符数与 token 数的换算比例有较大方差，此旁路仅用于「是否需要 offload」的快速判定，不替代实际 token 计数。

**预测性 Fold 及其 Cache Miss 阵痛管理**：
当 Token 占比超 65% 后台触发大模型压缩。由于 Fold 会直接破坏 Prefix 一致性，导致下一轮 API 请求发生 Cache Miss（首字延迟变长且产生 Miss 计费）。ContextManager 会针对该轮次抛出 `status` 事件，TUI 渲染 `"Context optimized, cold starting API..."` 以平抑用户焦虑，Token 预估系统也将该轮 Cache 命中率强制算为 0。

### 3.4 Tokenizer Worker Pool（分词器线程池）

为消除传统方案在主线程执行 BPE 算法造成的 TUI 假死，采用 Worker Threads 卸载 CPU 密集型任务。

**O(1) 任务 Map 调度优化**：
原设计中使用 `queue.find()` 查找回执会导致 O(n) 开销并容易引发 Promise 泄漏。改进为：
- 维护一个自增的 `this.taskId`。
- 使用 `Map<number, { resolve, reject }>` 作为任务槽。
- Worker 处理完数据携带 ID 返回，主线程 O(1) 取出 resolve 并从 Map 中 delete 释放内存。

### 3.5 ChatClient 抽象层（多 Provider 适配）

所有模型调用通过 `ChatClient` 接口抽象，实现与具体 provider 解耦：

```typescript
interface ChatClient {
  chatCompletionsStream(
    messages: ChatMessage[],
    opts: ChatClientOptions
  ): AsyncGenerator<StreamEvent>
}

interface ChatClientOptions {
  apiKey: string
  baseUrl: string
  model: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  tools?: ToolSpec[]
  thinking?: { type: "enabled" | "disabled" }
  reasoningEffort?: "low" | "medium" | "high" | "max"
}
```

**设计边界**：只抽象流式对话这一个接口，不动 SSE 解析、prefix-cache、重试逻辑。各 provider 内部实现各自的消息格式适配（如 DeepSeek 的 `reasoning_content` 剥离、Anthropic 的 content block 结构）。新增 provider 只需实现 `ChatClient` 接口即可接入。

**预设 Provider**：

| Provider | baseUrl | 默认模型 | 认证 |
|----------|---------|---------|------|
| **zen**（默认） | `https://opencode.ai/zen/v1` | `deepseek-v4-flash-free` | 免费，无需 API key |
| **mimo** | `https://api.mimo.com/v1` | `mimo-v1` | 免费，无需 API key |
| **deepseek** | `https://api.deepseek.com` | `deepseek-v4-flash` | 需 `DEEPSEEK_API_KEY` |
| **custom** | 用户自定义 | 用户自定义 | 按需 |

### 3.6 模型运行时切换（`/model` 命令）

TUI 内 `/model` 命令交互流程：

```text
> /model

  ╭─ 选择 Provider ───────────────────────╮
  │  [1] zen        免费 · 当前默认        │
  │  [2] mimo       免费                   │
  │  [3] deepseek   需 API key             │
  │  [4] custom     自定义 endpoint        │
  ╰────────────────────────────────────────╯

  选择 provider 后 → 自动展示该 provider 可用模型列表
  → 方向键选择 / 输入自定义模型名
  → 如果 provider 需要 API key → 提示输入（安全回显，存内存不落盘）
  → 切换即时生效，不影响当前会话上下文
```

**实现要点**：
- 模型切换不重置 `AppendOnlyLog`（仅影响后续 API 请求的目标 endpoint）
- API key 通过环境变量或 TUI 内输入，**不写入 `api-key` 文件**（除非用户显式要求）
- Zen/Mimo 免费 provider 默认不弹出 key 输入界面
- 切换后在 TUI 状态栏显示当前 provider + model

### 3.7 DeepSeekClient

当前唯一完整实现的 `ChatClient`。封装与 DeepSeek API 的交互，处理 SSE 解析、退避重试和 Usage 收割。
- **R1 适配**：对于 R1 模型的特有字段 `reasoning_content`，提取后通过事件流推给 TUI 渲染（可折叠展示），**不写入 AppendOnlyLog 上下文，不进入 API 请求**。

### 3.8 Tool-call Repair 流水线

防止因 JSON 格式损坏引发 API 二次重试计费。三阶段保障：
1. **Scavenge（拾荒）**：正则强取损坏内容。
2. **Truncation（截断）**：基于对象边界截断超出 MaxTokens 的参数。
3. **Storm（暴力）**：补全引号，去除非法转义字符。
若三阶段均失败，将 Error 作为 Feedback 抛回给模型，禁止引擎自我循环重试。

---

## 四、智能推理强度调节系统

### 4.1 功能概述

在每次用户输入后、API 调用前，插入"策略选择阶段"，自动分析复杂度并推荐档位。由 TaskClassifier、ChainEstimator 和 StrategySelector 协同工作，**全程 0 额外 API 成本（纯规则/算法）**。

### 4.2 档位定义 (CNY 本币计价)

**废弃所有硬编码的美元汇率**，底层与 UI 全面采用人民币 (CNY) 原生计价，避免换算。

| 档位 | 模型 | 适用场景 |
|------|------|---------|
| chat-fast | deepseek-chat | 问答、解释、单文件查找 (Temp 0.3) |
| chat-full | deepseek-chat | 常规编码、调试、小修改 (Temp 0.6) |
| reasoner-budget | deepseek-reasoner | 中等复杂、限制 Thinking 上限 |
| reasoner | deepseek-reasoner | 重构、架构、复杂 bug (Thinking 无上限) |

### 4.3 TaskClassifier（任务分类器）

纯规则引擎，不引入 LLM 延迟，接受有限的准确率（约 60-70%）：
1. **用户自定义覆盖**：优先加载 `classifier.json` 正则映射。
2. **信号打分**：文件引用数量、跨模块关键词、广度词汇（”全部”、”架构”等）进行加减分，最终 Clamp 到 0-10 分，映射到对应的推理档位。
3. **误判缓解**：5-6 分边界默认走 `reasoner-budget` 兜底；如果用户频繁手动切换档位，记录覆盖频率作为后续规则权重的迭代信号。
4. **已知局限**：纯规则无法区分”修复一个简单的 login bug”和”重构整个 auth 模块”——两者关键词高度重叠。此类场景依赖用户手动选择，或未来引入轻量级文件范围扫描辅助判定。

### 4.4 ChainEstimator（任务链估算器）

**动态滑动 TPS 窗口**：
由于大模型 API 响应速度存在潮汐现象，废除静态 TPS 公式。系统为 Chat 和 Reasoner 独立维护最近 10 次真实调用的 TPS 滑动均值，用于时间预估的粗略参考。由于 API 延迟主要由服务端排队时间主导而非模型推理吞吐，TPS 历史均值的预测准确度有限，最终币种预估以 token 计数为主要依据，TPS 为辅助参考。

**Agentic Chain 轮次补偿**：
由于 R1 处理复杂任务（如读 5 文件写 3 文件）必定产生多轮次 Agent 循环。当分数 $> 6$ 时，输出 Token 估算将乘以 **2~3 倍的链式轮次补偿系数**，彻底解决单轮视角的“预估账单远低于实际账单”的致命缺陷。

### 4.5 StrategySelector（策略选择器）

编排前两个模块，抛出 `StrategyNotifyEvent` 附带 3 秒倒计时。如果在倒计时内异步 glob 扫文件完成，将抛出 `strategy_estimate_refined` 事件精化 TUI 面板。

### 4.6 TUI 倒计时交互

TUI 渲染 4 个档位卡片，左右键切换，Enter 确认，超时自动使用推荐。面板原生展示 CNY 价格区间。

---

## 五、Token 用量预估系统

### 5.1 本币 Native 计价体系

使用 DeepSeek 官方 CNY 定价（Cache hit: 0.5/1，Cache miss: 2/4，Output: 8/16 元 / 1M Tokens）。直接输出人民币金额预估，取消 `0.14` 转换率。

### 5.2 预估维度与 Fold 感知

除了常规的前缀、增量预估，**TokenEstimator 必须具备 Fold 状态感知**。当检测到上下文本轮执行了合并，本轮请求的 Cache Hit 强行算作 0，Cache Miss 按全量上下文估算，向用户传递真实的费用预期。

---

## 六、壳层设计

### 6.1 集中式状态管理 (`state.ts`)

采用 `AgentState` 声明式更新，不直接修改对象树。`processEvents()` 函数接收事件队列，派生出全新的 TUI 渲染树，支持状态回溯。

### 6.2 双模式事件系统

- **核心拉模式 (AsyncGenerator)**：按需生成，解决背压。
- **壳层推模式 (EventStream + EventBus)**：支持多消费者（TUI、日志、插件）订阅。LoopEvent 联合类型完整涵盖了包括 `token_estimate` 在内的所有生命周期枚举。

### 6.3 多 Agent 系统

- **Build Agent**：全工具权限，执行修改。
- **Plan Agent**：只读权限（read, grep, lsp）。
- **无缝切换**：终端内 Tab 键秒切，切换时完成 Plan-to-Build 的分析结果继承（将分析报告压入 `system-reminder` 上下文）。

### 6.4 Plugin / Hooks 扩展系统

插件通过 Hook 点注入自定义逻辑，不修改核心代码。三类 Hook 点：

| Hook 点 | 触发时机 | 签名 | 用途 |
|---------|---------|------|------|
| `beforeToolCall` | 工具执行前，权限判定后 | `(tool: AgentTool, args: Record<string, unknown>, ctx: ToolContext) => MaybeModifiedArgs` | 权限拦截、参数修改、审计日志 |
| `afterToolCall` | 工具执行后，结果写入上下文前 | `(tool: AgentTool, result: ToolResult, ctx: ToolContext) => MaybeModifiedResult` | 结果后处理、LSP 反馈注入、自动纠错 |
| `onLoopEvent` | 每个 `LoopEvent` yield 后 | `(event: LoopEvent) => void` | 自定义 TUI 组件、外部通知、成本告警 |

**执行语义**：
- Hook 按注册顺序依次执行，前一个 Hook 的输出作为下一个 Hook 的输入
- `beforeToolCall` 返回 `{ block: true, reason: "..." }` 可阻止工具执行（权限拦截）
- 单个 Hook 抛异常时降级为 `warning` 事件，不阻断工具链
- `onLoopEvent` 为 fire-and-forget（异步执行，不阻塞主流）

**配置加载**：插件从 `.config/deepicode/plugins.json` 加载。每个插件声明其监听的 Hook 点和优先级。

---

## 七、工具层设计

### 7.1 流式异步 Hash-Anchored Edit（哈希锚定编辑）

**核心架构升级**：
传统方案读取 5MB 甚至更大的日志/JSON文件时，使用 `fs.readFileSync` 并在主线程逐行计算 SHA-256，会造成长达数秒的 Event Loop 阻塞，导致 TUI 假死卡顿。

**重构方案**：采用 **Stream-based 异步处理**。
使用 `fs.createReadStream`（Node.js）或 `Bun.file().stream()`（Bun）对文件进行流式切分，异步逐块处理。对于超大文件（5MB+），若单靠异步流式仍对主线程造成可感知延迟，可将 hash 计算 offload 到 Worker 线程。安全规则：任一 oldHash 匹配失败即回退到 fuzzy 降级。

### 7.2 9-Pass Fuzzy Edit（九轮模糊编辑）

在 Hash 因并发修改等原因严格不匹配时，启动安全网：
1. simpleMatch (精确)
2. lineTrimmedMatch (去尾白)
3. blockAnchorMatch (锚点模糊)
4. whitespaceNormalizedMatch (压缩连续空白)
5. indentationFlexibleMatch (忽略缩进)
6. escapeNormalizedMatch (统一转义)
7. trimmedBoundaryMatch (修剪边界)
8. contextAwareMatch (上下文定位)
9. multiOccurrenceMatch (多匹配选优)

### 7.3 Stale-read Validation 与系统级提权 (System-level Bypass)

**死锁痛点修复**：如果发现当前代码已经被外部修改，Agent 会自动发起重读操作（read_file）。但在 Deny-first 引擎下，如果默认规则要求 `Ask` 用户确认，这种机器自发的自动纠正会被弹窗打断，导致死锁。

**系统级免检提权**：
为内部生成的自动重试操作隐式注入 **System-level Bypass** 标志。安全层遇到该标志，静默放行读取操作。

**硬约束（代码级强制，非文档约定）**：

```typescript
function checkPermission(tool: AgentTool, bypass: boolean): PermissionDecision {
  // 写操作带 bypass 标志 → 视为安全漏洞，抛出硬错误
  if (bypass && tool.approval !== "read") {
    throw new Error(
      `System-level bypass denied: ${tool.name} is ${tool.approval}-tier, only read tools allowed`
    )
  }
  if (bypass) return { decision: "allow", reason: "system-bypass" }
  // ... 正常 Deny-first 三级判定
}
```

关键原则：**不是在文档里说"不要这样用"，而是在代码里让它不可能**。如果有人（或 bug）给 `edit`/`bash`/`write_file` 加上了 bypass 标志，安全层应抛出运行时硬错误而非静默放行。

### 7.4 其它工具集

- **LSP Touch**：文件编辑后触发 `vscode-languageclient`，3 秒内若发生类型或语法错误，自动反馈至本轮消息要求 LLM 修复。
- **内置工具集**：`read_file`（带敏感文件保护和 staleness 追踪）、`write_file`（创建/覆盖文件）、`list_dir`（结构化目录列表）、`grep`（正则搜索）、`edit`（hash-anchored + fuzzy fallback）、`bash`（带危险命令拦截、超时控制、输出截断）、Web Fetch、MCP、Python Kernel。

---

## 八、安全层设计

### 8.1 Deny-first 权限引擎

"默认拒绝"（Deny-first）。三级决策：`Deny` 规则优先（如拦截 `rm -rf /`），`Allow` 规则次之（如所有读操作），未命中强行 `Ask` 弹窗。

### 8.2 并发安全分类

由 `isConcurrencySafe` 布尔值控制。读安全，写独占。

### 8.3 Git Snapshot 局部单文件追踪

**大仓库优化**：
对于极大型项目（数十万个文件），复制整个工作区到 `~/.reasonix/snapshot/` 极度缓慢。改为在工作区根目录维护一个隐蔽的 `.deepicode_patches/` 目录，每次写操作前仅在其中生成**目标单文件的变更历史快照**。满足毫秒级 `revert()` 的同时避免 IO 阻塞。

---

## 九、数据流

### 9.1 单轮对话与并发控制数据流

1. 用户输入触发 TUI，状态机切为 `isStreaming`。
2. 策略引擎接管：TaskClassifier 分类 → ChainEstimator 动态预估 → 抛出倒计时 TUI。
3. 超时或确认后，执行 `DeepSeekClient.stream()` 发起请求。
4. 流式 buffer 中检测到完整 JSON 参数。
5. 读操作（`isConcurrencySafe=true`）立即 Eager Dispatch 并发执行；写操作等待 `finish_reason` 确认。
6. 并发结果合并回写，抛出 `done`，保存会话。

### 9.2 Context Fold 缓存断崖处理流

1. 计数器触及 65% 阈值，启动异步 Fold（由 LLM 对上下文做结构化压缩）。
2. Fold 完成后，调用 `SegmentedLog.compactInPlace()` 将压缩结果替换归档区，清空活跃区。
3. **新缓存基准建立**：压缩后的 `FoldedArchive` 成为新的 prefix-cache 基准。下一轮 API 请求将以此新前缀发起，此时必发生 Cache Miss（前缀已变），但之后的新活跃区消息追加在此新前缀上，后续轮次恢复 cache hit。
4. 抛出 `status` 事件（`context_optimized`），TUI 闪烁提示，Token Estimator 在下一轮强置 Cache Hit = 0，确保预期费用透明。
5. **长会话整体 cache hit 率**：取决于 Fold 频率。例如每 50 轮触发一次 Fold，则整体 cache hit 率约为 98%（49/50）。频繁触发的工具调用轮（只追加 tool result）不破坏前缀，cache hit 率更高。

---

## 十、接口定义

### 10.1 核心层与壳层接口

`CoreEngine` 接口：
- `submit(userInput, agent)` → `AsyncGenerator<LoopEvent>`
- `getState()` → `AgentState`
- `interrupt()` → `void`

`LoopEvent` 联合角色：
`assistant_delta`, `tool_call_delta`, `tool_start`, `tool`, `warning`, `error`, `status`, `done`, `strategy_notify`, `strategy_estimate_refined`, **`token_estimate`**。

### 10.2 工具层与权限接口

- `AgentTool`：`execute()`, `isConcurrencySafe`, JSON Schema spec。
- `PermissionSystem`：`check(tool, args, context)` → `PermissionDecision(allow/deny/ask)`。

---

## 十一、功能需求总览

### 11.1 核心引擎需求

| 需求 ID | 需求描述 | 优先级 | 备注 |
|---------|---------|--------|------|
| ENG-001 | Prefix-cache 优化的 SegmentedLog | P0 | 替代有歧义的 AppendOnlyLog |
| ENG-002 | DeepSeek API 客户端（SSE 流式） | P0 | 原生支持 |
| ENG-003 | Tool-call repair 流水线 | P0 | 防二次计费 |
| ENG-004 | R1 thought harvesting (防历史污染) | P0 | R1特色，拦截写入归档区 |
| ENG-005 | Tokenizer Worker (含 Bypass 阈值和 Map 回收) | P0 | 彻底消除 O(n) 与 IPC 卡顿 |
| ENG-006 | 分级 Eager Dispatch（读操作即刻执行，写操作保守确认） | P0 | 提速核心，零风险边界 |
| ENG-011 | ~~自动模型升级~~ | - | **(Superseded)** 已被 ENG-013/014/015 取代 |
| ENG-013 | TaskClassifier：零成本规则复杂度分类 | P1 | 策略系统 |
| ENG-014 | ChainEstimator：滑动 TPS 与 Agentic 链路补偿 | P1 | 策略系统 |
| ENG-015 | StrategySelector：倒计时与自动/手动模型降级 | P1 | 策略系统 |

### 11.2 壳层与编辑需求

| 需求 ID | 需求描述 | 优先级 | 备注 |
|---------|---------|--------|------|
| SHELL-001 | Ink/React TUI (终端原生界面) | P0 | |
| EDIT-001 | Stream-based Hash-anchored edits (异步流式防阻塞) | P0 | 核心大文件编辑方案 |
| EDIT-002 | 9-Pass Fuzzy Edit Matching ( fallback ) | P1 | 保底方案 |
| SEC-001 | Deny-first 权限规则引擎与 System-level bypass | P0 | 权限安全与防死锁提权 |

---

## 十二、非功能需求

### 12.1 性能
- **TUI 帧率**：大于 30fps，在大文件 Hash 流式计算与并发读写期间无卡顿。
- **Token 计数**：短增量（<2000字）O(1) 旁路同步计算，< 1ms；大文本卸载，不阻塞主线程。
- **响应速度**：读操作 Eager Dispatch 启动延迟 < 10ms（buffer 完整即刻调度，不等 finish_reason）。

### 12.2 成本
- **Cache Hit**：非 Fold 轮次最大化命中（取决于 prefix 稳定性）。长会话整体命中率取决于 Fold 频率（参见 §9.2）。
- **对账误差**：CNY 计价预估系统与 DeepSeek 真实账单差额目标 < 20%（待 tokenizer 和策略系统接入后实测校准）。

### 12.3 可靠性
- **并发保护**：哈希计算失败时抛弃更改；死循环 JSON 修理不重发请求。

---

## 十三、约束条件

- **语言与生态**：纯 TypeScript 编写，运行于 **Bun**（>= 1.3）。利用 Bun 的原生 TypeScript 执行、内置 fetch、Worker 及 Stream API。
- **架构红线**：不引入 Vercel AI SDK 等破坏原生 SSE 字段提取的中间层（MCP 协议客户端除外——MCP 是外部工具集成标准，不影响核心推理链路的 SSE 解析）；不可引入机器学习模型判定器（保证 0 Token 调度耗费）。
- **Provider 接缝**：`ChatClient` 接口是唯一的 provider 抽象边界。新增 provider 只需实现该接口，不修改引擎逻辑。但不同 provider 的 cache 机制可能完全不同（如 Anthropic 的 prompt cache 按 token 计费而非字节前缀），此时需要在 provider 内部自行处理差异。

---

## 十四、实施计划 (摘要)

详细计划见《Deepicode 实施计划》。总体分阶：
1. **Phase 0**：核心接口搭建。
2. **Phase 1**：核心引擎（Map Tokenizer, AST Eager, SegmentedLog）。
3. **Phase 2**：策略选择系统（CNY Native, 滑动 TPS）。
4. **Phase 3**：双模式事件与壳层。
5. **Phase 4**：工具层（流式异步 Hash 编辑重构, Bypass）。
6. **Phase 5**：安全层（单文件快照）。
7. **Phase 6/7**：LSP、TTSR 及最终压测调优。

---

## 十五、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| DeepSeek API 字段变化 | 中 | 高 | `ChatClient` 接口隔离；各 provider 内部独立处理字段解析 |
| Provider 定价/稳定性变化 | 中 | 高 | 多 provider 预设（Zen 免费/Mimo 免费/DeepSeek 官方/custom）；切换不影响引擎 |
| 竞争对手推出相似 cache 机制 | 低 | 中 | `ChatClient` 接口允许新增 provider 内部实现各自的 cache 优化，不影响上层 |
| JSON 假闭合防御失灵 | 低 | 低 | 分级策略已消除风险——写操作等完整确认，读操作误触发最多多读一个文件 |
| Worker 线程不可用 | 低 | 中 | 提供主线程降级计算 Fallback |
| glob 扫描耗时过长 | 中 | 中 | 对超大 monorepo 限制最多扫 50 个文件，设 500ms 超时强制中断 |
| 预估打分边缘效应 | 低 | 低 | 5~6 分处默认走 reasoner-budget 作为中坚兜底 |
| JSONL 写入被强杀中断 | 低 | 中 | 使用原子写操作（先写临时文件再 rename）确保可恢复性 |
| Bypass 标志被误用到写操作 | 低 | 高 | 代码级硬约束——非 read 工具带 bypass 标志时抛出硬错误 |

---

## 十六、技术栈

| 模块 | 技术与库 | 说明 |
|------|------|------|
| 运行时 | Bun >= 1.3 | 原生 TypeScript, Fetch, Worker, Streams |
| TUI 层 | Ink 4.x + React 18 | 终端渲染与组件树管理（暂未接入，当前为 readline CLI） |
| 分词器 | js-tiktoken (WASM) | 部署于 Worker 池，Map 队列调度（待实现） |
| 大文件编辑 | fs.createReadStream / Bun.file | 异步流式逐块处理，避免 readFileSync 阻塞 |
| 语言服务 | vscode-languageclient | 秒级类型推导和错误检查反馈（待实现） |
| 测试框架 | Vitest | 单元、E2E 及并发竞态压测 |