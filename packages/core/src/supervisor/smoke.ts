/**
 * Supervisor smoke test 辅助 — 验证候选 target 可用性。
 *
 * DRF-51：仅在 DEEPREEF_SUPERVISOR_SMOKE=1 时执行；StepFun 等未验证候选
 * 需 smoke test 通过后再启用。
 */

import type { ChatClient } from "../interface.js"
import type { DeepreefConfig } from "../config.js"
import type { SupervisorCandidate } from "./pool.js"

/** smoke test 环境变量名 */
export const DEEPREEF_SUPERVISOR_SMOKE_ENV = "DEEPREEF_SUPERVISOR_SMOKE"

/** smoke test 最小输出长度 */
const MIN_SMOKE_OUTPUT_LENGTH = 4

/** smoke test 请求超时 ms */
const SMOKE_TIMEOUT_MS = 30_000

/** smoke test 结果 */
export interface SupervisorSmokeResult {
  /** 是否通过 */
  passed: boolean
  /** 端到端延迟 ms */
  latencyMs: number
  /** 失败原因 */
  error?: string
  /** 响应文本摘要 */
  outputPreview?: string
}

/**
 * 判断 Supervisor smoke test 是否启用。
 * 仅当环境变量 DEEPREEF_SUPERVISOR_SMOKE=1 时返回 true。
 */
export function isSupervisorSmokeEnabled(): boolean {
  return process.env[DEEPREEF_SUPERVISOR_SMOKE_ENV] === "1"
}

/**
 * 对单个 Supervisor 候选执行 smoke test。
 * 发送简短 JSON 请求，验证模型返回非空文本。
 *
 * @param candidate - 待测候选
 * @param client - ChatClient 实例
 * @param config - 模型配置（来自 resolveModelTarget）
 */
export async function runSupervisorSmokeTest(
  candidate: SupervisorCandidate,
  client: ChatClient,
  config: DeepreefConfig,
): Promise<SupervisorSmokeResult> {
  if (!isSupervisorSmokeEnabled()) {
    return {
      passed: false,
      latencyMs: 0,
      error: "smoke test 未启用（需设置 DEEPREEF_SUPERVISOR_SMOKE=1）",
    }
  }

  const start = Date.now()
  let output = ""
  let errorMessage: string | undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS)

  try {
    const stream = client.chatCompletionsStream(
      [
        {
          role: "user",
          content: 'Respond with exactly: {"status":"ok"}',
        },
      ],
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        maxTokens: 64,
        temperature: 0,
        signal: controller.signal,
        keyless: !config.apiKey,
      },
    )

    for await (const event of stream) {
      if (event.type === "text_delta") {
        output += event.delta
      } else if (event.type === "reasoning_delta" && candidate.capabilities.reasoningText) {
        output += event.delta
      } else if (event.type === "error") {
        errorMessage = event.message
        break
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  } finally {
    clearTimeout(timer)
  }

  const latencyMs = Date.now() - start
  const trimmed = output.trim()

  if (errorMessage) {
    return {
      passed: false,
      latencyMs,
      error: errorMessage,
      outputPreview: trimmed.slice(0, 120),
    }
  }

  if (trimmed.length < MIN_SMOKE_OUTPUT_LENGTH) {
    return {
      passed: false,
      latencyMs,
      error: "模型返回空文本或仅 reasoning，smoke test 失败",
      outputPreview: trimmed.slice(0, 120),
    }
  }

  return {
    passed: true,
    latencyMs,
    outputPreview: trimmed.slice(0, 120),
  }
}

/**
 * 对池中全部启用候选批量执行 smoke test（需 DEEPREEF_SUPERVISOR_SMOKE=1）。
 *
 * @param candidates - 候选列表
 * @param resolveAndTest - 解析 target 并执行 smoke 的回调
 */
export async function runSupervisorPoolSmokeTests(
  candidates: SupervisorCandidate[],
  resolveAndTest: (candidate: SupervisorCandidate) => Promise<SupervisorSmokeResult>,
): Promise<Map<string, SupervisorSmokeResult>> {
  const results = new Map<string, SupervisorSmokeResult>()

  if (!isSupervisorSmokeEnabled()) {
    return results
  }

  for (const candidate of candidates) {
    if (!candidate.enabled) continue
    results.set(candidate.id, await resolveAndTest(candidate))
  }

  return results
}
