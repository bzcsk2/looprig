/**
 * Supervisor 候选路由 — 按能力、冷却、延迟、预算评分选择候选。
 *
 * DRF-51：评分维度包括 role capability、cooldown、结构化成功率、
 * 延迟、failure signature 预算与 session 预算。
 */

import type { SupervisorBudgetTracker } from "./budget.js"
import type { SupervisorCandidate, SupervisorPoolConfig } from "./pool.js"

/** 单候选运行时指标 */
export interface SupervisorCandidateMetrics {
  /** 结构化 JSON 输出成功率 0–1 */
  structuredSuccessRate?: number
  /** 平均延迟 ms */
  avgLatencyMs?: number
  /** 最近一次失败时间戳 ms */
  lastFailureAt?: number
}

/** 路由输入上下文 */
export interface SelectSupervisorInput {
  /** 候选池 */
  pool: SupervisorPoolConfig
  /** 预算追踪器 */
  budget: SupervisorBudgetTracker
  /** 当前 failure signature */
  failureSignature?: string
  /** evidence 预估 token 数 */
  evidenceTokenEstimate?: number
  /** 是否需要 structuredJson 能力 */
  requiresStructuredJson?: boolean
  /** 各候选运行时指标 */
  metrics?: Record<string, SupervisorCandidateMetrics>
  /** 当前时间戳 ms */
  now?: number
  /** 判断 target 是否已配置可用 */
  isTargetConfigured?: (targetId: string) => boolean
}

/** 路由评分条目 */
export interface ScoredSupervisorCandidate {
  candidate: SupervisorCandidate
  score: number
  excluded?: boolean
  excludeReason?: string
}

/** 路由选择结果 */
export interface SupervisorSelectionResult {
  /** 选中的候选，无可用时为 null */
  candidate: SupervisorCandidate | null
  /** 选择/拒绝原因 */
  reason: string
  /** 选中候选得分 */
  score?: number
  /** 全部评分（含被排除项） */
  scored: ScoredSupervisorCandidate[]
}

/** 冷却排除惩罚分 */
const COOLDOWN_PENALTY = 10_000

/** 能力不匹配惩罚分 */
const CAPABILITY_PENALTY = 5_000

/** 结构化成功率权重 */
const SUCCESS_RATE_WEIGHT = 30

/** 延迟惩罚系数（每 100ms 扣 1 分） */
const LATENCY_PENALTY_FACTOR = 100

/**
 * 计算单个 Supervisor 候选的路由得分。
 * 得分越高越优先；被排除的候选标记 excluded 并返回极低分。
 *
 * @param candidate - 候选
 * @param input - 路由输入
 * @param metrics - 候选运行时指标
 */
export function scoreSupervisorCandidate(
  candidate: SupervisorCandidate,
  input: SelectSupervisorInput,
  metrics: SupervisorCandidateMetrics = {},
): ScoredSupervisorCandidate {
  const now = input.now ?? Date.now()

  if (!candidate.enabled) {
    return {
      candidate,
      score: -Infinity,
      excluded: true,
      excludeReason: "候选已禁用",
    }
  }

  if (input.isTargetConfigured && !input.isTargetConfigured(candidate.target)) {
    return {
      candidate,
      score: -Infinity,
      excluded: true,
      excludeReason: `target ${candidate.target} 未配置`,
    }
  }

  const evidenceTokens = input.evidenceTokenEstimate ?? 0
  if (evidenceTokens > candidate.capabilities.maxEvidenceTokens) {
    return {
      candidate,
      score: -Infinity,
      excluded: true,
      excludeReason: `evidence ${evidenceTokens} tokens 超过候选上限 ${candidate.capabilities.maxEvidenceTokens}`,
    }
  }

  const budgetCheck = input.budget.canRequest({
    costClass: candidate.costClass,
    failureSignature: input.failureSignature,
    targetId: candidate.target,
    inputTokens: evidenceTokens,
    now,
  })
  if (!budgetCheck.allowed) {
    return {
      candidate,
      score: -Infinity,
      excluded: true,
      excludeReason: budgetCheck.reason,
    }
  }

  let score = candidate.priority

  if (input.requiresStructuredJson && !candidate.capabilities.structuredJson) {
    score -= CAPABILITY_PENALTY
  } else if (input.requiresStructuredJson && candidate.capabilities.structuredJson) {
    score += 50
  }

  if (input.budget.isOnCooldown(candidate.target, now)) {
    score -= COOLDOWN_PENALTY
  }

  if (typeof metrics.structuredSuccessRate === "number") {
    score += metrics.structuredSuccessRate * SUCCESS_RATE_WEIGHT
  }

  if (typeof metrics.avgLatencyMs === "number") {
    score -= metrics.avgLatencyMs / LATENCY_PENALTY_FACTOR
  }

  if (typeof metrics.lastFailureAt === "number" && now - metrics.lastFailureAt < 60_000) {
    score -= 20
  }

  const sigRemaining = input.budget.remainingSignatureBudget(input.failureSignature)
  if (sigRemaining <= 1) {
    score -= 10
  }

  const sessionRemaining = input.budget.remainingSessionBudget(candidate.costClass)
  if (sessionRemaining <= 2) {
    score -= 5
  }

  return { candidate, score }
}

/**
 * 从 Supervisor 池中选择最佳候选。
 * 按得分降序排列，返回首个未被排除的候选。
 *
 * @param input - 路由输入
 */
export function selectSupervisorCandidate(
  input: SelectSupervisorInput,
): SupervisorSelectionResult {
  const scored = input.pool.candidates.map((candidate) =>
    scoreSupervisorCandidate(
      candidate,
      input,
      input.metrics?.[candidate.id],
    ),
  )

  scored.sort((a, b) => b.score - a.score)

  const eligible = scored.filter((s) => !s.excluded)
  if (eligible.length === 0) {
    const reasons = scored
      .filter((s) => s.excludeReason)
      .map((s) => `${s.candidate.id}: ${s.excludeReason}`)
    return {
      candidate: null,
      reason: reasons.length > 0
        ? `无可用 Supervisor 候选 — ${reasons.join("; ")}`
        : "无可用 Supervisor 候选",
      scored,
    }
  }

  const best = eligible[0]!
  return {
    candidate: best.candidate,
    reason: `选中 ${best.candidate.id}（score=${best.score.toFixed(1)}）`,
    score: best.score,
    scored,
  }
}
