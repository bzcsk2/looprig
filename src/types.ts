// Zen API 默认配置（开放接口，无需真实 API key 即可使用）
export const ZEN_BASE_URL = "https://opencode.ai/zen/v1"
export const ZEN_API_KEY = "public"
export const ZEN_MODEL = "deepseek-v4-flash-free"

// 消息角色类型：system（系统提示）、user（用户）、assistant（助手）、tool（工具结果）
export type Role = "system" | "user" | "assistant" | "tool"

// ChatMessage：对话消息的通用格式
export interface ChatMessage {
  role: Role               // 消息角色
  content: string | null   // 消息文本内容，可为 null（如仅包含 tool_calls 的 assistant 消息）
  tool_calls?: ToolCall[]  // assistant 消息中携带的工具调用列表
  tool_call_id?: string    // tool 消息关联的 tool call ID
  name?: string            // tool 消息的工具名称
}

// ToolCall：LLM 发起的工具调用
export interface ToolCall {
  id: string              // 工具调用唯一 ID
  type: "function"        // 调用类型，固定为 function
  function: {
    name: string          // 工具名称
    arguments: string     // 参数的 JSON 字符串
  }
}

// ToolSpec：工具定义规范，描述工具给 LLM 看
export interface ToolSpec {
  type: "function"        // 工具类型，固定为 function
  function: {
    name: string                             // 工具名称
    description: string                      // 工具描述，LLM 据此决定何时调用
    parameters: Record<string, unknown>      // 参数 JSON Schema
  }
}

// Usage：token 用量统计
export interface Usage {
  prompt_tokens: number            // 提示词 token 数
  completion_tokens: number        // 回复 token 数
  total_tokens: number             // 总 token 数
  prompt_cache_hit_tokens?: number // 缓存命中 token 数（DeepSeek prefix-cache）
  prompt_cache_miss_tokens?: number// 缓存未命中 token 数
}

// AgentEvent：chat 方法产出的流式事件，驱动 UI 渲染
export interface AgentEvent {
  type: "text" | "reasoning" | "tool_call_start" | "tool_call_end" | "usage" | "error"
  content?: string    // 文本/推理内容
  toolCall?: ToolCall // 工具调用信息
  usage?: Usage       // token 用量
  error?: string      // 错误信息
}
