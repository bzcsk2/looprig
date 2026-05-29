import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from "./types.js"
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

function loadApiKeyFromProjectFile(): string | undefined {
  // workspace 默认位置：/vol4/Agent/deepicode/api-key
  // 内容示例：export DEEPSEEK_API_KEY="sk-..."
  try {
    const p = resolve(process.cwd(), "api-key")
    const raw = readFileSync(p, "utf-8")
    const match =
      raw.match(/^\s*export\s+DEEPSEEK_API_KEY\s*=\s*"([^"]+)"\s*$/m) ??
      raw.match(/^\s*export\s+DEEPSEEK_API_KEY\s*=\s*'([^']+)'\s*$/m) ??
      raw.match(/^\s*DEEPSEEK_API_KEY\s*=\s*"([^"]+)"\s*$/m) ??
      raw.match(/^\s*DEEPSEEK_API_KEY\s*=\s*'([^']+)'\s*$/m)
    const key = match?.[1]?.trim()
    return key ? key : undefined
  } catch {
    return undefined
  }
}

// 加载配置：优先读取环境变量，其次读取项目内 api-key 文件，最后回退到默认值
export function loadConfig(): DeepicodeConfig {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? loadApiKeyFromProjectFile() ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL ?? DEEPSEEK_MODEL,
    maxTokens: 8192,
    temperature: 0.3,
  }
}

// 构建 pi-ai Model 对象，用于 streamSimple / completeSimple 函数调用
// pi 在 pi/packages/ai/src/models.ts 中定义了各 provider 的模型配置
export function buildPiModel(config: DeepicodeConfig): Model {
  return {
    id: config.model,           // 模型 ID
    name: config.model,         // 模型名称
    api: "openai-completions",  // 兼容的 API 协议
    provider: "deepseek",       // 服务提供商标识
    baseUrl: config.baseUrl,    // API 请求地址
    reasoning: false,           // reasoning 由上游按需开启（thinking 模式）
    input: ["text"],            // 支持的输入格式
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: config.maxTokens,// 单次回复最大 token 数
  }
}
