// 从 types.ts 导入 Zen API 的默认值（开放接口免认证）
import { ZEN_API_KEY, ZEN_BASE_URL, ZEN_MODEL } from "./types.js"
// pi-ai 的模型类型定义
import type { Model } from "./vendor/pi.js"

// Deepicode 用户配置接口
export interface DeepicodeConfig {
  apiKey: string       // API 密钥，用于认证
  baseUrl: string      // API 基础地址
  model: string        // 模型名称
  maxTokens: number    // 单次回复最大 token 数
  temperature: number  // 采样温度，越低越确定
}

// 加载配置：优先读取环境变量，失败则回退到 types.ts 中的 Zen API 默认值
export function loadConfig(): DeepicodeConfig {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? ZEN_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? ZEN_BASE_URL,
    model: process.env.DEEPSEEK_MODEL ?? ZEN_MODEL,
    maxTokens: 8192,
    temperature: 0.3,
  }
}

// 构建 pi-ai Model 对象，用于 streamSimple / completeSimple 函数调用
// pi 在 pi/packages/ai/src/models.ts 中定义了各 provider 的模型配置
// 对于自定义 provider（如 Zen API），需要手动构造 Model 并设置 opencode.ai 兼容参数
// 详见 pi/packages/ai/src/types.ts:365 的 compat 说明
export function buildPiModel(config: DeepicodeConfig): Model {
  return {
    id: config.model,           // 模型 ID
    name: config.model,         // 模型名称
    api: "openai-completions",  // 兼容的 API 协议
    provider: "opencode",       // 服务提供商标识
    baseUrl: config.baseUrl,    // API 请求地址
    reasoning: false,           // 是否启用原生 reasoning（此处关闭，由下游处理）
    input: ["text"],            // 支持的输入格式
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },  // token 计费（无成本）
    contextWindow: 128000,      // 最大上下文窗口大小
    maxTokens: config.maxTokens,// 单次回复最大 token 数
    compat: {                   // pi-ai 兼容性配置
      supportsStore: false,                    // 不支持 store 参数
      supportsDeveloperRole: false,            // 不支持 developer 角色
      supportsReasoningEffort: false,          // 不支持 reasoning_effort 参数
      supportsUsageInStreaming: true,          // 流式响应中支持返回用量信息
      requiresToolResultName: true,            // tool result 消息需要 name 字段
      requiresAssistantAfterToolResult: false, // tool result 后不需要 assistant 占位
      requiresThinkingAsText: false,           // 思考过程不需要当作文本处理
      requiresReasoningContentOnAssistantMessages: false, // assistant 消息不需要 reasoning_content
    },
  }
}
