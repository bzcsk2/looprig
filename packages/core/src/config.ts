import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from "./types.js"
import type { Model } from "./vendor/pi.js"

export interface DeepicodeConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
  maxContextRounds?: number
  contextWindow?: number
  provider?: string
}

export interface ProviderModel {
  label: string
  model: string
}

export interface ProviderInfo {
  baseUrl: string
  model: string
  requiresKey: boolean
  label: string
  models: ProviderModel[]
  defaultKey?: string
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  zen: {
    baseUrl: "https://opencode.ai/zen/v1",
    model: "deepseek-v4-flash",
    requiresKey: false,
    label: "Zen (Free)",
    models: [
      { label: "deepseek-v4-flash", model: "deepseek-v4-flash" },
      { label: "mimo-v2.5", model: "mimo-v2.5" },
    ],
    defaultKey: "public",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    requiresKey: true,
    label: "DeepSeek",
    models: [
      { label: "pro", model: "deepseek-chat" },
      { label: "flash", model: "deepseek-v4-flash" },
    ],
  },
  mimo: {
    baseUrl: "https://api.mimo.ai/v1",
    model: "mimo-v2.5-pro",
    requiresKey: true,
    label: "Mimo",
    models: [
      { label: "mimo-v2.5-pro", model: "mimo-v2.5-pro" },
      { label: "mimo-v2.5", model: "mimo-v2.5" },
    ],
  },
}

export function getApiKeyEnvVar(provider: string): string {
  return `${provider.toUpperCase()}_API_KEY`
}

function loadApiKeyFromProjectFile(): string | undefined {
  try {
    const p = resolve(process.cwd(), "api-key")
    const raw = readFileSync(p, "utf-8")
    const match =
      raw.match(/^\s*export\s+DEEPSEEK_API_KEY\s*=\s*"([^"]+)"\s*$/m) ??
      raw.match(/^\s*export\s+DEEPSEEK_API_KEY\s*=\s*'([^']+)'\s*$/m) ??
      raw.match(/^\s*DEEPSEEK_API_KEY\s*=\s*"([^"]+)"\s*$/m) ??
      raw.match(/^\s*DEEPSEEK_API_KEY\s*=\s*'([^']+)'\s*$/m)
    
    const key = match?.[1]?.trim()
    if (key) return key
    
    const bareKey = raw.trim()
    if (bareKey.startsWith("sk-") || bareKey.startsWith("ak-")) {
      return bareKey
    }
    
    return undefined
  } catch {
    return undefined
  }
}

export function loadConfig(): DeepicodeConfig {
  const provider = process.env.DEEPICODE_PROVIDER ?? "deepseek"
  const providerCfg = PROVIDERS[provider]
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? providerCfg?.baseUrl ?? DEEPSEEK_BASE_URL
  const model = process.env.DEEPSEEK_MODEL ?? providerCfg?.model ?? DEEPSEEK_MODEL
  const apiKeyEnvVar = getApiKeyEnvVar(provider)

  let apiKey = process.env[apiKeyEnvVar] ?? providerCfg?.defaultKey ?? ""
  if (!apiKey && provider === "deepseek") {
    apiKey = loadApiKeyFromProjectFile() ?? ""
  }

  return {
    apiKey,
    baseUrl,
    model,
    maxTokens: 8192,
    temperature: 0.3,
    maxContextRounds: 20,
    contextWindow: 128_000,
    provider,
  }
}

export function buildPiModel(config: DeepicodeConfig): Model {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: config.provider ?? "deepseek",
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: config.maxTokens,
  }
}
