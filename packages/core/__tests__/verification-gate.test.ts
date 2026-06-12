import { describe, expect, it } from "vitest"

import {
  isVerificationBlockingFinal,
  buildVerificationGatePrompt,
  evaluateVerificationGate,
  shouldResetVerificationGateCounter,
  maybeResetVerificationGateCounter,
  processVerificationCommandResult,
  DEFAULT_MAX_GATE_CONTINUATIONS,
} from "../src/governance/verification-gate.js"
import {
  buildVerificationDigest,
  buildVerificationSuccessSummary,
  isBuildVerificationCommand,
  parseVitestFailureDigest,
  parseVitestSuccessSummary,
} from "../src/governance/verification-digest.js"
import { isHarnessVerificationCommand } from "../src/governance/verification-command.js"
import type { TaskLedger } from "../src/task-ledger.js"

function makeLedger(overrides: Partial<TaskLedger> = {}): TaskLedger {
  return {
    goal: "fix bug",
    plan: [],
    changedFiles: [],
    commandsRun: [],
    verificationPending: false,
    blockers: [],
    ...overrides,
  }
}

describe("isVerificationBlockingFinal", () => {
  it("无改动时不拦截", () => {
    expect(isVerificationBlockingFinal(makeLedger(), true)).toBe(false)
  })

  it("有改动且 pending 时拦截", () => {
    const ledger = makeLedger({
      changedFiles: ["a.ts"],
      verificationPending: true,
    })
    expect(isVerificationBlockingFinal(ledger, true)).toBe(true)
  })

  it("requireVerification=false 时不拦截", () => {
    const ledger = makeLedger({
      changedFiles: ["a.ts"],
      verificationPending: true,
    })
    expect(isVerificationBlockingFinal(ledger, false)).toBe(false)
  })

  it("验证通过后不拦截", () => {
    const ledger = makeLedger({
      changedFiles: ["a.ts"],
      verificationPending: false,
      lastVerification: { command: "npm test", exitCode: 0, summary: "5 tests passed" },
    })
    expect(isVerificationBlockingFinal(ledger, true)).toBe(false)
  })
})

describe("evaluateVerificationGate", () => {
  it("blocking 时返回 prompt", () => {
    const ledger = makeLedger({ changedFiles: ["a.ts"], verificationPending: true })
    const state = { continuationCount: 0 }
    const decision = evaluateVerificationGate(ledger, true, state)
    expect(decision.blocking).toBe(true)
    expect(decision.prompt).toContain("Verification required")
    expect(decision.requiresUser).toBe(false)
  })

  it("达到 max continuations 时 requiresUser", () => {
    const ledger = makeLedger({ changedFiles: ["a.ts"], verificationPending: true })
    const state = { continuationCount: DEFAULT_MAX_GATE_CONTINUATIONS }
    const decision = evaluateVerificationGate(ledger, true, state)
    expect(decision.requiresUser).toBe(true)
    expect(decision.prompt).toContain("Gate limit reached")
  })
})

describe("shouldResetVerificationGateCounter", () => {
  it("blocking 解除时归零", () => {
    expect(shouldResetVerificationGateCounter(true, true, false)).toBe(true)
  })

  it("pending 减少时归零", () => {
    expect(shouldResetVerificationGateCounter(true, false, true)).toBe(true)
  })

  it("仍 blocking 且 pending 未变时不归零", () => {
    expect(shouldResetVerificationGateCounter(true, true, true)).toBe(false)
  })
})

describe("maybeResetVerificationGateCounter", () => {
  it("条件满足时重置计数", () => {
    const state = { continuationCount: 5 }
    maybeResetVerificationGateCounter(state, true, false, false)
    expect(state.continuationCount).toBe(0)
  })

  it("仍 blocking 时不重置", () => {
    const state = { continuationCount: 3 }
    maybeResetVerificationGateCounter(state, true, true, true)
    expect(state.continuationCount).toBe(3)
  })
})

describe("verification-digest", () => {
  it("识别验收命令", () => {
    expect(isHarnessVerificationCommand("npm test")).toBe(true)
    expect(isHarnessVerificationCommand("npx vitest run")).toBe(true)
    expect(isHarnessVerificationCommand("npm run build")).toBe(true)
    expect(isHarnessVerificationCommand("echo hello")).toBe(false)
  })

  it("parseVitestFailureDigest 提取失败信息", () => {
    const output = [
      "FAIL test/unit/a.test.ts > case",
      "AssertionError: expected true to be false",
    ].join("\n")
    const digest = parseVitestFailureDigest(output)
    expect(digest).toContain("[Verification digest]")
    expect(digest).toMatch(/AssertionError/)
  })

  it("parseVitestSuccessSummary 提取成功摘要", () => {
    const out = " Test Files  8 passed (8)\n      Tests  22 passed (22)"
    expect(parseVitestSuccessSummary(out)).toBe("8 files / 22 tests passed")
  })

  it("buildVerificationDigest 含 next-step 提示", () => {
    const digest = buildVerificationDigest(
      "npm test",
      "FAIL test/a.test.ts\nAssertionError: boom",
    )
    expect(digest).toMatch(/read_file the failing test/)
  })

  it("buildVerificationSuccessSummary 对 build 命令", () => {
    expect(isBuildVerificationCommand("npm run build")).toBe(true)
    const summary = buildVerificationSuccessSummary(
      "npm run build",
      "✓ built in 2.1s",
    )
    expect(summary).toContain("build succeeded")
  })
})

describe("processVerificationCommandResult", () => {
  it("成功时返回 summary", () => {
    const result = processVerificationCommandResult(
      "npm test",
      "Tests  3 passed (3)",
      0,
    )
    expect(result.passed).toBe(true)
    expect(result.summary).toBeTruthy()
  })

  it("失败时返回 digest", () => {
    const result = processVerificationCommandResult(
      "npm test",
      "FAIL test/a.test.ts\nAssertionError: x",
      1,
    )
    expect(result.passed).toBe(false)
    expect(result.digest).toContain("[Verification digest]")
  })
})

describe("buildVerificationGatePrompt", () => {
  it("列出 changed files", () => {
    const prompt = buildVerificationGatePrompt(makeLedger({
      changedFiles: ["src/a.ts", "src/b.ts"],
      verificationPending: true,
    }))
    expect(prompt).toContain("src/a.ts")
    expect(prompt).toContain("src/b.ts")
  })
})
