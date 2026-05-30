import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
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
    model: "zen-free",
    requiresKey: false,
    label: "Zen (Free)",
    models: [
      { label: "deepseek-v4-flash-free", model: "deepseek-v4-flash-free" },
      { label: "mimo-v2.5-free", model: "mimo-v2.5-free" },
    ],
    defaultKey: "public",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4",
    requiresKey: true,
    label: "DeepSeek",
    models: [
      { label: "pro", model: "deepseek-v4-pro" },
      { label: "flash", model: "deepseek-v4-flash" },
    ],
  },
  mimo: {
    baseUrl: "https://api.mimo.ai/v1",
    model: "mimo-v2.5",
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

const LAST_CONFIG_FILE = ".deepicode/last-config.json"

export function saveLastConfig(cfg: { provider: string; model: string; baseUrl: string }): void {
  try {
    const dir = join(process.cwd(), ".deepicode")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "last-config.json"), JSON.stringify(cfg, null, 2), "utf8")
  } catch {}
}

function loadLastConfig(): { provider?: string; model?: string; baseUrl?: string } | null {
  try {
    const raw = readFileSync(resolve(process.cwd(), LAST_CONFIG_FILE), "utf8")
    return JSON.parse(raw) as { provider?: string; model?: string; baseUrl?: string }
  } catch {
    return null
  }
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
  // Priority: env vars > persisted last-config > defaults
  const last = loadLastConfig()

  const provider = process.env.DEEPICODE_PROVIDER ?? last?.provider ?? "deepseek"
  const providerCfg = PROVIDERS[provider]

  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? last?.baseUrl ?? providerCfg?.baseUrl ?? DEEPSEEK_BASE_URL

  const model = process.env.DEEPSEEK_MODEL ?? last?.model ?? providerCfg?.model ?? DEEPSEEK_MODEL

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
