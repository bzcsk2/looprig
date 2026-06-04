import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from "./types.js"

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
    model: "deepseek-v4-flash-free",
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

function getBaseUrlEnvVar(provider: string): string {
  return `${provider.toUpperCase()}_BASE_URL`
}

function getModelEnvVar(provider: string): string {
  return `${provider.toUpperCase()}_MODEL`
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

function loadApiKeyFromProjectFile(provider?: string): string | undefined {
  try {
    const p = resolve(process.cwd(), "api-key")
    const raw = readFileSync(p, "utf-8")

    // Try provider-specific env var (e.g. DEEPSEEK_API_KEY, ZEN_API_KEY, MIMO_API_KEY)
    const providers = provider ? [provider.toUpperCase()] : ["DEEPSEEK", "ZEN", "MIMO"]
    for (const pv of providers) {
      const envName = `${pv}_API_KEY`
      const match =
        raw.match(new RegExp(`^\\s*export\\s+${envName}\\s*=\\s*"([^"]+)"\\s*$`, "m")) ??
        raw.match(new RegExp(`^\\s*export\\s+${envName}\\s*=\\s*'([^']+)'\\s*$`, "m")) ??
        raw.match(new RegExp(`^\\s*${envName}\\s*=\\s*"([^"]+)"\\s*$`, "m")) ??
        raw.match(new RegExp(`^\\s*${envName}\\s*=\\s*'([^']+)'\\s*$`, "m"))
      const key = match?.[1]?.trim()
      if (key) return key
    }

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

  const provider = process.env.DEEPICODE_PROVIDER ?? last?.provider ?? "zen"
  const providerCfg = PROVIDERS[provider]
  const lastForProvider = last?.provider === provider ? last : null

  const providerBaseUrlEnv = process.env[getBaseUrlEnvVar(provider)]
  const legacyDeepSeekBaseUrlEnv = provider === "deepseek" ? process.env.DEEPSEEK_BASE_URL : undefined
  const baseUrl = providerBaseUrlEnv ?? legacyDeepSeekBaseUrlEnv ?? lastForProvider?.baseUrl ?? providerCfg?.baseUrl ?? DEEPSEEK_BASE_URL

  const providerModelEnv = process.env[getModelEnvVar(provider)]
  const legacyDeepSeekModelEnv = provider === "deepseek" ? process.env.DEEPSEEK_MODEL : undefined
  const rawModel = providerModelEnv ?? legacyDeepSeekModelEnv ?? lastForProvider?.model ?? providerCfg?.model ?? DEEPSEEK_MODEL
  const model = normalizeModelForProvider(providerCfg, rawModel)

  const apiKeyEnvVar = getApiKeyEnvVar(provider)
  let apiKey = process.env[apiKeyEnvVar] ?? providerCfg?.defaultKey ?? ""
  if (!apiKey) {
    apiKey = loadApiKeyFromProjectFile(provider) ?? ""
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

function normalizeModelForProvider(providerCfg: ProviderInfo | undefined, model: string): string {
  if (!providerCfg || providerCfg.models.length === 0) return model
  if (providerCfg.models.some((entry) => entry.model === model)) return model
  return providerCfg.models[0]?.model ?? providerCfg.model
}
