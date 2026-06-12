/**
 * Supervisor 预算与冷却追踪器。
 *
 * DRF-51：session 次数预算、failure signature 预算、token 上限与 target 冷却。
 */

import type { SupervisorCostClass } from "./pool.js"

/** Supervisor 预算配置 */
export interface SupervisorBudgetConfig {
  /** 每 session 免费 Supervisor 最大次数 */
  maxFreePerSession: number
  /** 每 session 付费 Supervisor 最大次数（默认 0） */
  maxPaidPerSession: number
  /** 同 failure signature 最大请求次数 */
  maxPerSignature: number
  /** 单次 evidence 输入 token 上限 */
  maxInputTokens: number
  /** 单次 advice 输出 token 上限 */
  maxOutputTokens: number
  /** target 默认冷却毫秒 */
  defaultCooldownMs: number
}

/** 默认 Supervisor 预算 */
export const DEFAULT_SUPERVISOR_BUDGET: SupervisorBudgetConfig = {
  maxFreePerSession: 8,
  maxPaidPerSession: 0,
  maxPerSignature: 2,
  maxInputTokens: 8000,
  maxOutputTokens: 800,
  defaultCooldownMs: 30_000,
}

/** 预算判定结果 */
export interface SupervisorBudgetCheck {
  allowed: boolean
  reason?: string
}

/** 单次 Supervisor 请求记录 */
export interface SupervisorRequestRecord {
  targetId: string
  failureSignature?: string
  costClass: SupervisorCostClass
  inputTokens: number
  outputTokens: number
  at: number
}

/**
 * Supervisor 预算追踪器 — 追踪 session 计数、签名计数与 target 冷却。
 */
export class SupervisorBudgetTracker {
  private sessionFreeCount = 0
  private sessionPaidCount = 0
  private sessionFreeTierCount = 0
  private readonly signatureCounts = new Map<string, number>()
  private readonly cooldownUntil = new Map<string, number>()
  readonly config: SupervisorBudgetConfig

  /**
   * @param config - 预算配置，默认 DEFAULT_SUPERVISOR_BUDGET
   */
  constructor(config: Partial<SupervisorBudgetConfig> = {}) {
    this.config = { ...DEFAULT_SUPERVISOR_BUDGET, ...config }
  }

  /**
   * 判断某 costClass 是否属于免费类别（free 或 free-tier）。
   */
  isFreeCostClass(costClass: SupervisorCostClass): boolean {
    return costClass === "free" || costClass === "free-tier"
  }

  /**
   * 获取 session 内某成本类别的剩余配额。
   *
   * @param costClass - 成本类别
   */
  remainingSessionBudget(costClass: SupervisorCostClass): number {
    if (costClass === "paid") {
      return Math.max(0, this.config.maxPaidPerSession - this.sessionPaidCount)
    }
    if (costClass === "free-tier") {
      return Math.max(0, this.config.maxFreePerSession - this.sessionFreeTierCount)
    }
    return Math.max(0, this.config.maxFreePerSession - this.sessionFreeCount)
  }

  /**
   * 获取某 failure signature 的剩余配额。
   *
   * @param signature - 失败签名
   */
  remainingSignatureBudget(signature: string | undefined): number {
    if (!signature) return this.config.maxPerSignature
    const used = this.signatureCounts.get(signature) ?? 0
    return Math.max(0, this.config.maxPerSignature - used)
  }

  /**
   * 判断 target 是否处于冷却中。
   *
   * @param targetId - ModelTarget ID
   * @param now - 当前时间戳 ms
   */
  isOnCooldown(targetId: string, now: number = Date.now()): boolean {
    const until = this.cooldownUntil.get(targetId)
    return typeof until === "number" && until > now
  }

  /**
   * 获取 target 剩余冷却毫秒。
   *
   * @param targetId - ModelTarget ID
   * @param now - 当前时间戳 ms
   */
  getCooldownRemaining(targetId: string, now: number = Date.now()): number {
    const until = this.cooldownUntil.get(targetId)
    if (typeof until !== "number") return 0
    return Math.max(0, until - now)
  }

  /**
   * 校验 token 预算是否在限制内。
   *
   * @param inputTokens - 预估输入 token
   * @param outputTokens - 预估输出 token
   */
  checkTokenBudget(inputTokens: number, outputTokens: number): SupervisorBudgetCheck {
    if (inputTokens > this.config.maxInputTokens) {
      return {
        allowed: false,
        reason: `evidence 输入 ${inputTokens} tokens 超过上限 ${this.config.maxInputTokens}`,
      }
    }
    if (outputTokens > this.config.maxOutputTokens) {
      return {
        allowed: false,
        reason: `advice 输出 ${outputTokens} tokens 超过上限 ${this.config.maxOutputTokens}`,
      }
    }
    return { allowed: true }
  }

  /**
   * 综合判定是否允许发起 Supervisor 请求。
   *
   * @param opts - 判定参数
   */
  canRequest(opts: {
    costClass: SupervisorCostClass
    failureSignature?: string
    targetId?: string
    inputTokens?: number
    outputTokens?: number
    now?: number
  }): SupervisorBudgetCheck {
    const now = opts.now ?? Date.now()

    if (opts.targetId && this.isOnCooldown(opts.targetId, now)) {
      return {
        allowed: false,
        reason: `target ${opts.targetId} 冷却中，剩余 ${this.getCooldownRemaining(opts.targetId, now)}ms`,
      }
    }

    if (this.remainingSessionBudget(opts.costClass) <= 0) {
      return {
        allowed: false,
        reason: `${opts.costClass} session 预算已耗尽`,
      }
    }

    if (opts.failureSignature && this.remainingSignatureBudget(opts.failureSignature) <= 0) {
      return {
        allowed: false,
        reason: `failure signature ${opts.failureSignature} 已达请求上限`,
      }
    }

    const inputTokens = opts.inputTokens ?? 0
    const outputTokens = opts.outputTokens ?? this.config.maxOutputTokens
    const tokenCheck = this.checkTokenBudget(inputTokens, outputTokens)
    if (!tokenCheck.allowed) return tokenCheck

    return { allowed: true }
  }

  /**
   * 记录一次 Supervisor 请求并设置冷却。
   *
   * @param record - 请求记录
   * @param cooldownMs - 冷却毫秒，默认使用配置值
   */
  recordRequest(record: SupervisorRequestRecord, cooldownMs?: number): void {
    if (record.costClass === "paid") {
      this.sessionPaidCount += 1
    } else if (record.costClass === "free-tier") {
      this.sessionFreeTierCount += 1
    } else {
      this.sessionFreeCount += 1
    }

    if (record.failureSignature) {
      const prev = this.signatureCounts.get(record.failureSignature) ?? 0
      this.signatureCounts.set(record.failureSignature, prev + 1)
    }

    const ms = cooldownMs ?? this.config.defaultCooldownMs
    this.cooldownUntil.set(record.targetId, record.at + ms)
  }

  /** 获取 session 免费请求计数 */
  getSessionFreeCount(): number {
    return this.sessionFreeCount
  }

  /** 获取 session 付费请求计数 */
  getSessionPaidCount(): number {
    return this.sessionPaidCount
  }

  /** 获取某 failure signature 的请求计数 */
  getSignatureCount(signature: string): number {
    return this.signatureCounts.get(signature) ?? 0
  }

  /** 重置 session 计数（测试或新 session 时使用） */
  resetSession(): void {
    this.sessionFreeCount = 0
    this.sessionPaidCount = 0
    this.sessionFreeTierCount = 0
    this.signatureCounts.clear()
    this.cooldownUntil.clear()
  }
}
