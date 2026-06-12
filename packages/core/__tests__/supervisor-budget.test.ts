import { describe, expect, it } from "vitest"

import {
  DEFAULT_SUPERVISOR_BUDGET,
  SupervisorBudgetTracker,
} from "../src/supervisor/budget.js"

describe("DEFAULT_SUPERVISOR_BUDGET", () => {
  it("默认 session 免费上限 8 次", () => {
    expect(DEFAULT_SUPERVISOR_BUDGET.maxFreePerSession).toBe(8)
  })

  it("默认同 signature 上限 2 次", () => {
    expect(DEFAULT_SUPERVISOR_BUDGET.maxPerSignature).toBe(2)
  })

  it("默认 token 上限 8k 输入 / 800 输出", () => {
    expect(DEFAULT_SUPERVISOR_BUDGET.maxInputTokens).toBe(8000)
    expect(DEFAULT_SUPERVISOR_BUDGET.maxOutputTokens).toBe(800)
  })

  it("默认付费 Oracle 0 次", () => {
    expect(DEFAULT_SUPERVISOR_BUDGET.maxPaidPerSession).toBe(0)
  })
})

describe("SupervisorBudgetTracker", () => {
  it("session 免费预算耗尽后拒绝", () => {
    const tracker = new SupervisorBudgetTracker({ maxFreePerSession: 2 })
    tracker.recordRequest({
      targetId: "supervisor.zen-free",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })
    tracker.recordRequest({
      targetId: "supervisor.mimo-free",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })

    const check = tracker.canRequest({ costClass: "free" })
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("session 预算已耗尽")
  })

  it("failure signature 预算耗尽后拒绝", () => {
    const tracker = new SupervisorBudgetTracker({ maxPerSignature: 2 })
    const sig = "err-test-sig"
    tracker.recordRequest({
      targetId: "supervisor.zen-free",
      failureSignature: sig,
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })
    tracker.recordRequest({
      targetId: "supervisor.zen-free",
      failureSignature: sig,
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })

    const check = tracker.canRequest({ costClass: "free", failureSignature: sig })
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("failure signature")
  })

  it("付费预算默认 0 拒绝", () => {
    const tracker = new SupervisorBudgetTracker()
    const check = tracker.canRequest({ costClass: "paid" })
    expect(check.allowed).toBe(false)
  })

  it("token 超限拒绝", () => {
    const tracker = new SupervisorBudgetTracker()
    const check = tracker.canRequest({
      costClass: "free",
      inputTokens: 9000,
    })
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("evidence 输入")
  })

  it("冷却期间拒绝同一 target", () => {
    const tracker = new SupervisorBudgetTracker({ defaultCooldownMs: 60_000 })
    const now = Date.now()
    tracker.recordRequest({
      targetId: "supervisor.zen-free",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: now,
    })

    expect(tracker.isOnCooldown("supervisor.zen-free", now + 1000)).toBe(true)
    expect(tracker.getCooldownRemaining("supervisor.zen-free", now + 1000)).toBeGreaterThan(0)

    const check = tracker.canRequest({
      costClass: "free",
      targetId: "supervisor.zen-free",
      now: now + 1000,
    })
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("冷却中")
  })

  it("冷却结束后允许再次请求", () => {
    const tracker = new SupervisorBudgetTracker({ defaultCooldownMs: 1000 })
    const now = Date.now()
    tracker.recordRequest({
      targetId: "supervisor.zen-free",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: now,
    })

    const check = tracker.canRequest({
      costClass: "free",
      targetId: "supervisor.zen-free",
      now: now + 2000,
    })
    expect(check.allowed).toBe(true)
  })

  it("resetSession 清空计数", () => {
    const tracker = new SupervisorBudgetTracker({ maxFreePerSession: 1 })
    tracker.recordRequest({
      targetId: "supervisor.zen-free",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })
    expect(tracker.getSessionFreeCount()).toBe(1)

    tracker.resetSession()
    expect(tracker.getSessionFreeCount()).toBe(0)
    expect(tracker.canRequest({ costClass: "free" }).allowed).toBe(true)
  })

  it("remainingSessionBudget 与 remainingSignatureBudget", () => {
    const tracker = new SupervisorBudgetTracker({
      maxFreePerSession: 8,
      maxPerSignature: 2,
    })
    expect(tracker.remainingSessionBudget("free")).toBe(8)
    expect(tracker.remainingSignatureBudget("sig-a")).toBe(2)

    tracker.recordRequest({
      targetId: "t1",
      failureSignature: "sig-a",
      costClass: "free",
      inputTokens: 100,
      outputTokens: 50,
      at: Date.now(),
    })
    expect(tracker.remainingSessionBudget("free")).toBe(7)
    expect(tracker.remainingSignatureBudget("sig-a")).toBe(1)
    expect(tracker.getSignatureCount("sig-a")).toBe(1)
  })
})
