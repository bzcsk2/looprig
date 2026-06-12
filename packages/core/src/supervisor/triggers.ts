/**
 * Supervisor 触发器 — 判定 Worker 是否应请求 SupervisorAdvice。
 *
 * DRF-50：借鉴 SmallCode adaptive_router 失败率阈值、reviewer 触发条件、
 * iceCoder BranchBudget / verification / early-stop 信号（MIT）。
 * Source refs: smallcode/src/model/adaptive_router.js, smallcode/src/model/reviewer.js
 */

import type {
  AskSupervisorRequest,
  FailureClass,
  SupervisorTriggerConfig,
  SupervisorTriggerContext,
  SupervisorTriggerDecision,
  SupervisorTriggerReason,
} from "./types.js"
import {
  DEFAULT_SUPERVISOR_TRIGGER_CONFIG,
} from "./types.js"

/** EarlyStop reason 到 Supervisor 触发 reason 的映射 */
const STOP_SIGNAL_TRIGGERS: Record<string, SupervisorTriggerReason> = {
  read_loop: "read_loop",
  read_loop_warning: "read_loop",
  patch_spiral: "patch_spiral",
  repetition_loop: "repetition_loop",
  greeting_regression: "greeting_regression",
}

/** EarlyStop reason 到 FailureClass 的映射 */
const STOP_SIGNAL_FAILURE_CLASS: Record<string, FailureClass> = {
  read_loop: "wrong_strategy",
  read_loop_warning: "wrong_strategy",
  patch_spiral: "wrong_strategy",
  repetition_loop: "wrong_strategy",
  greeting_regression: "goal_drift",
}

/**
 * 解析 Worker 输出中的结构化 ask_supervisor 请求。
 * 支持 JSON 对象或 `<ask_supervisor>...</ask_supervisor>` 包裹。
 */
export function parseAskSupervisorRequest(text: string): AskSupervisorRequest | null {
  if (typeof text !== "string" || text.length === 0) return null

  const tagMatch = text.match(/<ask_supervisor>\s*([\s\S]*?)\s*<\/ask_supervisor>/i)
  const candidates = [tagMatch?.[1], text]

  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()

    if (/^\{[\s\S]*\}$/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        if (parsed.ask_supervisor === true || parsed.type === "ask_supervisor") {
          return {
            reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
            failureClass: isFailureClass(parsed.failureClass) ? parsed.failureClass : undefined,
          }
        }
      } catch {
        // 继续尝试其他格式
      }
    }

    const inline = trimmed.match(/\{"ask_supervisor"\s*:\s*true[\s\S]*?\}/)
    if (inline) {
      try {
        const parsed = JSON.parse(inline[0]) as Record<string, unknown>
        return {
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
          failureClass: isFailureClass(parsed.failureClass) ? parsed.failureClass : undefined,
        }
      } catch {
        // ignore
      }
    }
  }

  return null
}

/**
 * 判断 TaskLedger 是否处于无净进展状态。
 */
export function isLedgerStagnant(
  stagnantRounds: number | undefined,
  threshold: number,
): boolean {
  return typeof stagnantRounds === "number" && stagnantRounds >= threshold
}

/**
 * 检查同 failure signature 是否已耗尽 Supervisor 配额或无新 evidence。
 */
export function isSignatureBudgetExhausted(
  signature: string | undefined,
  evidenceHash: string | undefined,
  history: Record<string, { count: number; lastEvidenceHash?: string }> | undefined,
  maxPerSignature: number,
): boolean {
  if (!signature || !history) return false
  const record = history[signature]
  if (!record) return false
  if (record.count >= maxPerSignature) {
    if (!evidenceHash || record.lastEvidenceHash === evidenceHash) {
      return true
    }
  }
  return false
}

/**
 * 从 recentFailures 中取最高 count 的错误签名。
 */
export function peakErrorSignature(
  recentFailures: SupervisorTriggerContext["recentFailures"],
): { signature: string; count: number } | null {
  if (!recentFailures?.length) return null
  let best = recentFailures[0]!
  for (const entry of recentFailures) {
    if (entry.count > best.count) best = entry
  }
  return { signature: best.signature, count: best.count }
}

function isFailureClass(value: unknown): value is FailureClass {
  return typeof value === "string" && [
    "tool_format",
    "wrong_strategy",
    "missing_context",
    "verification_failure",
    "goal_drift",
    "provider_failure",
    "unknown",
  ].includes(value)
}

function deny(
  ctx: SupervisorTriggerContext,
  config: SupervisorTriggerConfig,
): SupervisorTriggerDecision | null {
  if (ctx.supervisorConfigured === false) {
    return { shouldRequest: false, message: "Supervisor 未配置" }
  }
  if (ctx.providerRateLimited) {
    return { shouldRequest: false, message: "Provider 限流，应先 failover/cooldown" }
  }
  if (ctx.userContinuedSameStrategy) {
    return { shouldRequest: false, message: "用户刚要求继续当前策略" }
  }
  if (ctx.singleToolFailureOnly) {
    return { shouldRequest: false, message: "单次普通工具失败不触发 Supervisor" }
  }
  const sig = ctx.currentFailureSignature
    ?? peakErrorSignature(ctx.recentFailures)?.signature
  if (isSignatureBudgetExhausted(
    sig,
    ctx.currentEvidenceHash,
    ctx.failureSignatureHistory,
    config.maxRequestsPerSignature,
  )) {
    return { shouldRequest: false, message: "同失败签名无新 evidence 或已达请求上限" }
  }
  return null
}

function accept(
  reason: SupervisorTriggerReason,
  failureClass: FailureClass,
  message: string,
): SupervisorTriggerDecision {
  return { shouldRequest: true, reason, failureClass, message }
}

/**
 * 判定是否应请求 SupervisorAdvice。
 *
 * 触发：BranchBudget block、错误签名阈值、验证连续失败、salvage 连续失败、
 * read loop / patch spiral / repetition / greeting regression、ask_supervisor、
 * goal drift、TaskLedger 无进展。
 *
 * 不触发：单次工具失败、provider 429、无新 evidence 的重复失败、
 * 用户要求继续同一策略、Supervisor 未配置。
 */
export function shouldRequestSupervisor(
  ctx: SupervisorTriggerContext,
  config: Partial<SupervisorTriggerConfig> = {},
): SupervisorTriggerDecision {
  const cfg: SupervisorTriggerConfig = { ...DEFAULT_SUPERVISOR_TRIGGER_CONFIG, ...config }

  const blocked = deny(ctx, cfg)
  if (blocked) return blocked

  if (ctx.askSupervisor) {
    return accept(
      "ask_supervisor",
      ctx.askSupervisor.failureClass ?? "unknown",
      ctx.askSupervisor.reason ?? "Worker 请求 Supervisor 指导",
    )
  }

  if (ctx.branchBlock?.blocked) {
    return accept(
      "branch_budget_block",
      "wrong_strategy",
      ctx.branchBlock.message ?? "BranchBudget 硬拦截",
    )
  }

  if (ctx.branchRecover?.triggered) {
    return accept(
      "branch_budget_block",
      "wrong_strategy",
      ctx.branchRecover.reason ?? "BranchBudget 分支预算耗尽",
    )
  }

  const peak = peakErrorSignature(ctx.recentFailures)
  if (
    peak
    && peak.count >= cfg.errorSignatureThreshold
    && peak.count >= cfg.minErrorSamples
  ) {
    return accept(
      "error_signature_threshold",
      "unknown",
      `同错误签名 ${peak.signature} 已出现 ${peak.count} 次`,
    )
  }

  if (
    typeof ctx.consecutiveVerificationFailures === "number"
    && ctx.consecutiveVerificationFailures >= cfg.consecutiveVerificationFailures
  ) {
    return accept(
      "verification_failure",
      "verification_failure",
      `验证连续失败 ${ctx.consecutiveVerificationFailures} 次`,
    )
  }

  if (
    typeof ctx.consecutiveSalvageFailures === "number"
    && ctx.consecutiveSalvageFailures >= cfg.consecutiveSalvageFailures
  ) {
    return accept(
      "salvage_failure",
      "tool_format",
      `tool-call salvage 连续失败 ${ctx.consecutiveSalvageFailures} 次`,
    )
  }

  if (ctx.stopSignal?.reason) {
    const triggerReason = STOP_SIGNAL_TRIGGERS[ctx.stopSignal.reason]
    if (triggerReason) {
      return accept(
        triggerReason,
        STOP_SIGNAL_FAILURE_CLASS[ctx.stopSignal.reason] ?? "wrong_strategy",
        ctx.stopSignal.message,
      )
    }
  }

  if (ctx.goalDriftDetected) {
    return accept("goal_drift", "goal_drift", "检测到任务目标漂移")
  }

  if (isLedgerStagnant(ctx.ledgerStagnantRounds, cfg.ledgerStagnantRoundThreshold)) {
    return accept(
      "ledger_no_progress",
      "wrong_strategy",
      `TaskLedger ${ctx.ledgerStagnantRounds} 轮无净进展`,
    )
  }

  return { shouldRequest: false }
}
