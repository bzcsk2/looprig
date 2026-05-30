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

export interface ProviderInfo {
  baseUrl: string
  model: string
  requiresKey: boolean
  label: string
  models: string[]
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    requiresKey: true,
    label: "DeepSeek",
    models: ["deepseek-v4-flash", "deepseek-v4", "deepseek-r1", "deepseek-chat"],
  },
  zen: {
    baseUrl: "https://opencode.ai/zen/v1",
    model: "deepseek-v4-flash-free",
    requiresKey: false,
    label: "Zen (Free)",
    models: ["deepseek-v4-flash-free"],
  },
  mimo: {
    baseUrl: "https://mimo.p.rapidapi.com",
    model: "mimo-v1",
    requiresKey: false,
    label: "Mimo (Free)",
    models: ["mimo-v1"],
  },
  custom: {
    baseUrl: "",
    model: "",
    requiresKey: true,
    label: "Custom",
    models: [],
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

  let apiKey = process.env[apiKeyEnvVar] ?? process.env.DEEPSEEK_API_KEY ?? ""
  if (!apiKey) {
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
