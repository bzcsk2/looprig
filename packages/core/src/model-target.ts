/**
 * ModelTarget — 角色化模型端点解析
 *
 * DRF-10: Worker/Supervisor 可使用不同 provider/baseUrl/model/client
 * 解决 subagent child engine 共享父级 client 的问题
 */

import type { DeepreefConfig, ProviderInfo } from "./config.js"
import { PROVIDERS, getModelContextWindow } from "./config.js"
import type { ChatClient } from "./interface.js"
import { DeepSeekClient } from "./client.js"
import type { RuntimeLogger } from "./runtime-logger.js"

/** 模型角色 */
export type ModelRole = "worker" | "supervisor" | "oracle" | "summarizer"

/** API Key 策略 */
export type ApiKeyPolicy = "keyless" | "provider-env" | "explicit"

/**
 * 模型目标：provider/model/baseUrl/key 一起解析
 */
export interface ModelTarget {
  id: string
  role: ModelRole
  provider: string
  model: string
  baseUrl: string
  apiKeyPolicy: ApiKeyPolicy
  apiKey?: string
  contextWindow?: number
  maxTokens?: number
  temperature?: number
  keyless?: boolean
}

/** 内置默认 target 定义 */
export const DEFAULT_TARGETS: Record<string, Omit<ModelTarget, "apiKey">> = {
  "worker.local": {
    id: "worker.local",
    role: "worker",
    provider: "openai-compatible",
    model: "",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyPolicy: "keyless",
    keyless: true,
    contextWindow: 32_768,
    maxTokens: 4096,
    temperature: 0.2,
  },
  "supervisor.zen-free": {
    id: "supervisor.zen-free",
    role: "supervisor",
    provider: "zen",
    model: "deepseek-v4-flash-free",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKeyPolicy: "keyless",
    keyless: true,
    contextWindow: 1_000_000,
    maxTokens: 800,
    temperature: 0.3,
  },
  "oracle.optional": {
    id: "oracle.optional",
    role: "oracle",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    apiKeyPolicy: "provider-env",
    contextWindow: 1_000_000,
    maxTokens: 8192,
    temperature: 0.3,
  },
}

export interface ModelTargetConfig {
  targets?: Record<string, Partial<ModelTarget>>
}

/**
 * 从环境变量解析 API Key
 */
function resolveApiKey(provider: string, policy: ApiKeyPolicy, explicit?: string): string {
  if (policy === "keyless") return ""
  if (policy === "explicit" && explicit) return explicit

  const envVar = `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`
  return process.env[envVar] ?? ""
}

/**
 * 解析 ModelTarget
 *
 * @param targetId - target ID（如 "worker.local"）
 * @param baseConfig - 当前引擎配置（作为 fallback）
 * @param overrides - 项目级 target 覆盖
 */
export function resolveModelTarget(
  targetId: string,
  baseConfig: DeepreefConfig,
  overrides?: Record<string, Partial<ModelTarget>>,
): ModelTarget | null {
  const builtin = DEFAULT_TARGETS[targetId]
  const override = overrides?.[targetId]
  const merged = builtin ? { ...builtin, ...override } : override

  if (!merged) {
    // 未配置 target 时，使用 baseConfig 作为默认
    if (!targetId) return null
    return null
  }

  const provider = merged.provider ?? baseConfig.provider ?? "zen"
  const providerCfg: ProviderInfo | undefined = PROVIDERS[provider]
  const model = merged.model ?? providerCfg?.model ?? baseConfig.model
  const baseUrl = merged.baseUrl ?? providerCfg?.baseUrl ?? baseConfig.baseUrl
  const apiKeyPolicy = merged.apiKeyPolicy ?? (providerCfg?.keyless ? "keyless" : "provider-env")
  const keyless = merged.keyless ?? providerCfg?.keyless ?? false

  return {
    id: targetId,
    role: merged.role ?? "worker",
    provider,
    model,
    baseUrl,
    apiKeyPolicy,
    apiKey: resolveApiKey(provider, apiKeyPolicy, merged.apiKey),
    contextWindow: merged.contextWindow ?? getModelContextWindow(provider, model),
    maxTokens: merged.maxTokens ?? baseConfig.maxTokens,
    temperature: merged.temperature ?? baseConfig.temperature,
    keyless,
  }
}

/**
 * 从 baseConfig 创建默认 target（兼容无 target 配置时）
 */
export function targetFromConfig(config: DeepreefConfig, role: ModelRole = "worker"): ModelTarget {
  const provider = config.provider ?? "zen"
  const providerCfg = PROVIDERS[provider]
  return {
    id: `${role}.default`,
    role,
    provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeyPolicy: providerCfg?.keyless ? "keyless" : "provider-env",
    apiKey: config.apiKey,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    keyless: providerCfg?.keyless,
  }
}

/**
 * 为 ModelTarget 创建独立 ChatClient
 */
export function createClientForTarget(
  target: ModelTarget,
  logger?: RuntimeLogger,
): ChatClient {
  return new DeepSeekClient(logger)
}

/**
 * 将 ModelTarget 转为 DeepreefConfig 片段（供 child engine 使用）
 */
export function targetToConfig(target: ModelTarget): DeepreefConfig {
  return {
    apiKey: target.apiKey ?? "",
    baseUrl: target.baseUrl,
    model: target.model,
    maxTokens: target.maxTokens ?? 8192,
    temperature: target.temperature ?? 0.3,
    contextWindow: target.contextWindow,
    provider: target.provider,
  }
}
