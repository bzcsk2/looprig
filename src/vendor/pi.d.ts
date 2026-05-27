// pi-ai 包装器的类型声明
// Pi 仓库: https://github.com/earendil-works/pi-mono
// 源码位置: pi/packages/ai/src/*
//
// 这些类型是 deepicode 所用到的 pi-ai API 子集的声明
// 运行时实现在 pi.mjs 中（从 pi 源码导入）

// AssistantMessageEvent：助手消息流事件联合类型
// pi-ai 将 LLM 流式输出拆解为一系列细粒度事件
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }                                             // 流开始，包含初始空消息
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }                  // 文本块开始
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }   // 文本增量
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }   // 文本块结束
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }              // 思考块开始
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage } // 思考增量
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage } // 思考块结束
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }              // 工具调用开始
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage } // 工具调用参数增量
  | { type: "toolcall_end"; contentIndex: number; toolCall: PiToolCall; partial: AssistantMessage } // 工具调用完成
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }      // 流结束
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage }                 // 流错误

// TextContent：文本内容块
export interface TextContent {
  type: "text"   // 内容类型标识
  text: string   // 文本内容
}

// ThinkingContent：思考过程内容块（DeepSeek reasoning）
export interface ThinkingContent {
  type: "thinking"  // 内容类型标识
  thinking: string  // 思考过程文本
}

// PiToolCall：pi-ai 格式的工具调用
export interface PiToolCall {
  type: "toolCall"                 // 内容类型标识
  id: string                       // 工具调用唯一 ID
  name: string                     // 工具名称
  arguments: Record<string, unknown> // 工具参数（键值对形式）
}

// Usage：pi-ai 的 token 用量格式
export interface Usage {
  input: number            // 输入 token 数
  output: number           // 输出 token 数
  totalTokens: number      // 总 token 数
  cacheRead: number        // 缓存读取（命中）token 数
  cacheWrite: number       // 缓存写入（未命中）token 数
  cost: {
    input: number          // 输入成本
    output: number         // 输出成本
    cacheRead: number      // 缓存命中减免后的成本
    cacheWrite: number     // 缓存未命中成本
    total: number          // 总成本
  }
}

// StopReason：流结束原因
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted"

// AssistantMessage：完整的助手回复消息
export interface AssistantMessage {
  role: "assistant"                         // 角色固定为 assistant
  content: (TextContent | ThinkingContent | PiToolCall)[]  // 回复内容数组（文本/思考/工具调用混合）
  api: string                               // 使用的 API 类型
  provider: string                          // 服务提供商
  model: string                             // 模型名称
  responseModel?: string                    // 实际响应的模型（可能与请求不同）
  responseId?: string                       // 响应 ID
  usage: Usage                              // token 用量
  stopReason: StopReason                    // 结束原因
  errorMessage?: string                     // 错误信息（仅出错时存在）
  timestamp: number                         // 时间戳
}

// AssistantMessageEventStream：异步可迭代的事件流
export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>        // 获取最终 AssistantMessage 的 Promise
  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>  // 异步迭代器
}

// Model：pi-ai 的模型配置
export interface Model {
  id: string                                                       // 模型 ID
  name: string                                                     // 模型名称
  api: string                                                      // API 协议类型（如 openai-completions）
  provider: string                                                 // 服务提供商
  baseUrl: string                                                  // API 请求地址
  reasoning: boolean                                               // 是否启用原生 reasoning
  input: string[]                                                  // 支持的输入格式列表
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }  // 计费标准
  contextWindow: number                                            // 上下文窗口大小
  maxTokens: number                                                // 最大输出 token 数
  compat?: Record<string, unknown>                                 // provider 兼容性参数
}

// Context：请求上下文
export interface Context {
  systemPrompt?: string   // 系统提示词（可选）
  messages: unknown[]     // 消息列表
  tools?: unknown[]       // 工具描述列表（可选）
}

// SimpleStreamOptions：流式请求的配置选项
export interface SimpleStreamOptions {
  temperature?: number                           // 采样温度
  maxTokens?: number                             // 最大输出 token 数
  signal?: AbortSignal                           // 中止信号
  apiKey?: string                                // API 密钥
  transport?: string                             // 传输方式
  cacheRetention?: string                        // 缓存保留策略
  sessionId?: string                             // 会话 ID
  headers?: Record<string, string>               // 自定义请求头
  onPayload?: (payload: unknown, model: Model) => unknown | undefined | Promise<unknown | undefined>  // 请求体拦截回调
  onResponse?: (response: { status: number; headers: Record<string, string> }, model: Model) => void | Promise<void>  // 响应拦截回调
  timeoutMs?: number                             // 超时时间（毫秒）
  maxRetries?: number                            // 最大重试次数
  reasoning?: string                             // reasoning 模式配置
}

// 流式对话函数：返回事件流
export function streamSimple(model: Model, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream
// 非流式对话函数：直接返回完整的 AssistantMessage
export function completeSimple(model: Model, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>
