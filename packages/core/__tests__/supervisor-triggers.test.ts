import { describe, expect, it } from "vitest"

import {
  isLedgerStagnant,
  isSignatureBudgetExhausted,
  parseAskSupervisorRequest,
  peakErrorSignature,
  shouldRequestSupervisor,
} from "../src/supervisor/triggers.js"
import { DEFAULT_SUPERVISOR_TRIGGER_CONFIG } from "../src/supervisor/types.js"

describe("parseAskSupervisorRequest", () => {
  it("解析 JSON ask_supervisor 对象", () => {
    const req = parseAskSupervisorRequest(
      '{"ask_supervisor": true, "reason": "stuck on tests", "failureClass": "verification_failure"}',
    )
    expect(req).toEqual({
      reason: "stuck on tests",
      failureClass: "verification_failure",
    })
  })

  it("解析 XML 包裹的 ask_supervisor", () => {
    const req = parseAskSupervisorRequest(
      '<ask_supervisor>{"ask_supervisor": true, "reason": "need help"}</ask_supervisor>',
    )
    expect(req?.reason).toBe("need help")
  })

  it("无法解析时返回 null", () => {
    expect(parseAskSupervisorRequest("just text")).toBeNull()
  })
})

describe("shouldRequestSupervisor — 触发", () => {
  it("BranchBudget block 触发", () => {
    const decision = shouldRequestSupervisor({
      branchBlock: { blocked: true, message: "file edit limit" },
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("branch_budget_block")
    expect(decision.failureClass).toBe("wrong_strategy")
  })

  it("错误签名达到阈值触发", () => {
    const decision = shouldRequestSupervisor({
      recentFailures: [{ signature: "err-a", count: 3, at: 0 }],
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("error_signature_threshold")
  })

  it("验证连续失败触发", () => {
    const decision = shouldRequestSupervisor({
      consecutiveVerificationFailures: 2,
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("verification_failure")
  })

  it("salvage 连续失败触发", () => {
    const decision = shouldRequestSupervisor({
      consecutiveSalvageFailures: 3,
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("salvage_failure")
    expect(decision.failureClass).toBe("tool_format")
  })

  it("read loop EarlyStop 触发", () => {
    const decision = shouldRequestSupervisor({
      stopSignal: { reason: "read_loop", message: "8 reads without output" },
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("read_loop")
  })

  it("patch spiral 触发", () => {
    const decision = shouldRequestSupervisor({
      stopSignal: { reason: "patch_spiral", message: "patch stuck" },
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("patch_spiral")
  })

  it("repetition loop 触发", () => {
    const decision = shouldRequestSupervisor({
      stopSignal: { reason: "repetition_loop", message: "repeating" },
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("repetition_loop")
  })

  it("greeting regression 触发 goal_drift", () => {
    const decision = shouldRequestSupervisor({
      stopSignal: { reason: "greeting_regression", message: "hello mid-task" },
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("greeting_regression")
    expect(decision.failureClass).toBe("goal_drift")
  })

  it("Worker ask_supervisor 触发", () => {
    const decision = shouldRequestSupervisor({
      askSupervisor: { reason: "blocked", failureClass: "missing_context" },
    })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("ask_supervisor")
    expect(decision.failureClass).toBe("missing_context")
  })

  it("goal drift 触发", () => {
    const decision = shouldRequestSupervisor({ goalDriftDetected: true })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("goal_drift")
  })

  it("TaskLedger 无进展触发", () => {
    const decision = shouldRequestSupervisor({ ledgerStagnantRounds: 5 })
    expect(decision.shouldRequest).toBe(true)
    expect(decision.reason).toBe("ledger_no_progress")
  })
})

describe("shouldRequestSupervisor — 不触发", () => {
  it("单次普通工具失败不触发", () => {
    const decision = shouldRequestSupervisor({ singleToolFailureOnly: true })
    expect(decision.shouldRequest).toBe(false)
  })

  it("provider 429 不触发", () => {
    const decision = shouldRequestSupervisor({
      providerRateLimited: true,
      branchBlock: { blocked: true },
    })
    expect(decision.shouldRequest).toBe(false)
  })

  it("用户要求继续同一策略不触发", () => {
    const decision = shouldRequestSupervisor({
      userContinuedSameStrategy: true,
      branchBlock: { blocked: true },
    })
    expect(decision.shouldRequest).toBe(false)
  })

  it("同签名无新 evidence 且已达上限不触发", () => {
    const decision = shouldRequestSupervisor({
      currentFailureSignature: "sig-1",
      currentEvidenceHash: "hash-a",
      failureSignatureHistory: {
        "sig-1": { count: 2, lastEvidenceHash: "hash-a" },
      },
      branchBlock: { blocked: true },
    })
    expect(decision.shouldRequest).toBe(false)
  })

  it("Supervisor 未配置不触发", () => {
    const decision = shouldRequestSupervisor({
      supervisorConfigured: false,
      branchBlock: { blocked: true },
    })
    expect(decision.shouldRequest).toBe(false)
  })

  it("错误签名未达 minErrorSamples 不触发", () => {
    const decision = shouldRequestSupervisor(
      { recentFailures: [{ signature: "e", count: 2, at: 0 }] },
      { ...DEFAULT_SUPERVISOR_TRIGGER_CONFIG, minErrorSamples: 3 },
    )
    expect(decision.shouldRequest).toBe(false)
  })
})

describe("trigger helpers", () => {
  it("isLedgerStagnant", () => {
    expect(isLedgerStagnant(4, 5)).toBe(false)
    expect(isLedgerStagnant(5, 5)).toBe(true)
  })

  it("isSignatureBudgetExhausted", () => {
    expect(isSignatureBudgetExhausted("s", "h1", { s: { count: 2, lastEvidenceHash: "h1" } }, 2)).toBe(true)
    expect(isSignatureBudgetExhausted("s", "h2", { s: { count: 2, lastEvidenceHash: "h1" } }, 2)).toBe(false)
  })

  it("peakErrorSignature", () => {
    const peak = peakErrorSignature([
      { signature: "a", count: 2, at: 0 },
      { signature: "b", count: 5, at: 1 },
    ])
    expect(peak).toEqual({ signature: "b", count: 5 })
  })
})
