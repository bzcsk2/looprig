import { describe, expect, it } from "vitest"

import { SupervisorBudgetTracker } from "../src/supervisor/budget.js"
import { DEFAULT_SUPERVISOR_POOL } from "../src/supervisor/pool.js"
import {
  scoreSupervisorCandidate,
  selectSupervisorCandidate,
} from "../src/supervisor/router.js"

const configuredTargets = new Set(["supervisor.zen-free", "supervisor.mimo-free"])

describe("scoreSupervisorCandidate", () => {
  it("高优先级候选得分更高", () => {
    const budget = new SupervisorBudgetTracker()
    const deepseek = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "zen-deepseek")!
    const mimo = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "zen-mimo")!

    const input = {
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      isTargetConfigured: (t: string) => configuredTargets.has(t),
    }

    const deepseekScore = scoreSupervisorCandidate(deepseek, input).score
    const mimoScore = scoreSupervisorCandidate(mimo, input).score
    expect(deepseekScore).toBeGreaterThan(mimoScore)
  })

  it("requiresStructuredJson 时无 structuredJson 能力扣分", () => {
    const budget = new SupervisorBudgetTracker()
    const stepfun = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "stepfun-3.5")!
    const enabledStepfun = { ...stepfun, enabled: true }

    const withReq = scoreSupervisorCandidate(enabledStepfun, {
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      requiresStructuredJson: true,
      isTargetConfigured: () => true,
    })
    const withoutReq = scoreSupervisorCandidate(enabledStepfun, {
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      requiresStructuredJson: false,
      isTargetConfigured: () => true,
    })

    expect(withoutReq.score).toBeGreaterThan(withReq.score)
  })

  it("冷却中候选被大幅扣分", () => {
    const budget = new SupervisorBudgetTracker({ defaultCooldownMs: 60_000 })
    const now = Date.now()
    const candidate = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "zen-deepseek")!

    budget.recordRequest({
      targetId: candidate.target,
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: now,
    })

    const scored = scoreSupervisorCandidate(candidate, {
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      now: now + 1000,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })
    expect(scored.score).toBeLessThan(candidate.priority)
  })

  it("未配置 target 被排除", () => {
    const budget = new SupervisorBudgetTracker()
    const candidate = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "zen-mimo")!

    const scored = scoreSupervisorCandidate(candidate, {
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      isTargetConfigured: () => false,
    })
    expect(scored.excluded).toBe(true)
    expect(scored.excludeReason).toContain("未配置")
  })

  it("metrics 影响得分：高成功率与低延迟加分", () => {
    const budget = new SupervisorBudgetTracker()
    const candidate = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "zen-mimo")!

    const base = scoreSupervisorCandidate(candidate, {
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    const boosted = scoreSupervisorCandidate(
      candidate,
      {
        pool: DEFAULT_SUPERVISOR_POOL,
        budget,
        isTargetConfigured: (t) => configuredTargets.has(t),
      },
      {
        structuredSuccessRate: 1.0,
        avgLatencyMs: 200,
      },
    )

    expect(boosted.score).toBeGreaterThan(base.score)
  })
})

describe("selectSupervisorCandidate", () => {
  it("选择得分最高且可用的候选", () => {
    const budget = new SupervisorBudgetTracker()
    const result = selectSupervisorCandidate({
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    expect(result.candidate).not.toBeNull()
    expect(result.candidate!.id).toBe("zen-deepseek")
    expect(result.score).toBeDefined()
    expect(result.scored.length).toBe(DEFAULT_SUPERVISOR_POOL.candidates.length)
  })

  it("failure signature 预算耗尽时无可用候选", () => {
    const budget = new SupervisorBudgetTracker({ maxPerSignature: 2 })
    const sig = "repeat-err"

    budget.recordRequest({
      targetId: "supervisor.zen-free",
      failureSignature: sig,
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })
    budget.recordRequest({
      targetId: "supervisor.mimo-free",
      failureSignature: sig,
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })

    const result = selectSupervisorCandidate({
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      failureSignature: sig,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    expect(result.candidate).toBeNull()
    expect(result.reason).toContain("无可用 Supervisor 候选")
  })

  it("session 预算耗尽时无可用候选", () => {
    const budget = new SupervisorBudgetTracker({ maxFreePerSession: 1 })
    budget.recordRequest({
      targetId: "supervisor.zen-free",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })

    const result = selectSupervisorCandidate({
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    expect(result.candidate).toBeNull()
  })

  it("evidence token 超限排除候选", () => {
    const budget = new SupervisorBudgetTracker()
    const result = selectSupervisorCandidate({
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      evidenceTokenEstimate: 10_000,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    expect(result.candidate).toBeNull()
    expect(result.scored.every((s) => s.excluded)).toBe(true)
  })

  it("冷却时 fallback 到次优候选", () => {
    const budget = new SupervisorBudgetTracker({ defaultCooldownMs: 60_000 })
    const now = Date.now()
    const deepseek = DEFAULT_SUPERVISOR_POOL.candidates.find((c) => c.id === "zen-deepseek")!

    budget.recordRequest({
      targetId: deepseek.target,
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: now,
    })

    const result = selectSupervisorCandidate({
      pool: DEFAULT_SUPERVISOR_POOL,
      budget,
      now: now + 1000,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    expect(result.candidate!.id).toBe("zen-mimo")
  })

  it("禁用候选不被选中", () => {
    const budget = new SupervisorBudgetTracker()
    const pool = {
      candidates: DEFAULT_SUPERVISOR_POOL.candidates.map((c) =>
        c.id === "zen-deepseek" ? { ...c, enabled: false } : c,
      ),
    }

    const result = selectSupervisorCandidate({
      pool,
      budget,
      isTargetConfigured: (t) => configuredTargets.has(t),
    })

    expect(result.candidate!.id).toBe("zen-mimo")
  })
})
