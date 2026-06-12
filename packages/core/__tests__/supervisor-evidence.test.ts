import { describe, expect, it } from "vitest"

import {
  buildEvidenceBundle,
  defaultFailureSummary,
  deriveAttemptedStrategies,
  extractActiveStep,
  hashEvidenceBundle,
  normalizeEvidenceForHash,
  truncateEvidenceText,
  trimEvidenceFailures,
  trimEvidenceTools,
} from "../src/supervisor/evidence.js"

describe("extractActiveStep", () => {
  it("返回 active 步骤", () => {
    const step = extractActiveStep([
      { text: "read code", status: "done" },
      { text: "fix bug", status: "active" },
    ])
    expect(step).toBe("fix bug")
  })

  it("无 active 时返回首个 pending", () => {
    const step = extractActiveStep([
      { text: "done step", status: "done" },
      { text: "next step", status: "pending" },
    ])
    expect(step).toBe("next step")
  })
})

describe("buildEvidenceBundle", () => {
  it("从 TaskLedger 与工具结果构建证据包", () => {
    const bundle = buildEvidenceBundle({
      ledger: {
        goal: "fix failing test",
        plan: [
          { text: "run test", status: "done" },
          { text: "patch src", status: "active" },
        ],
        changedFiles: ["src/a.ts", "src/b.ts"],
        lastVerification: {
          command: "npm test",
          exitCode: 1,
          summary: "AssertionError: expected 1",
        },
        blockers: ["[verification] npm test failed"],
      },
      failureClass: "verification_failure",
      recentFailures: [{ signature: "assert-1", summary: "expected 1 got 0" }],
      recentTools: [
        { name: "bash", success: false, summary: "npm test exit 1" },
        { name: "read_file", success: true, summary: "src/a.ts" },
      ],
      attemptedStrategies: ["retry npm test"],
      verificationTail: "FAIL src/a.test.ts",
      stopSignalReason: "verification_failure",
    })

    expect(bundle.goal).toBe("fix failing test")
    expect(bundle.activeStep).toBe("patch src")
    expect(bundle.failureClass).toBe("verification_failure")
    expect(bundle.changedFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(bundle.verification).toMatchObject({
      command: "npm test",
      exitCode: 1,
      tail: "FAIL src/a.test.ts",
    })
    expect(bundle.recentTools).toHaveLength(2)
    expect(bundle.attemptedStrategies.some(s => s.includes("early_stop"))).toBe(true)
  })

  it("无 recentFailures 时从 blockers 或 failureClass 兜底", () => {
    const fromBlockers = buildEvidenceBundle({
      ledger: {
        goal: "task",
        changedFiles: [],
        blockers: ["build failed"],
      },
      failureClass: "wrong_strategy",
    })
    expect(fromBlockers.recentFailures[0]?.summary).toContain("build failed")

    const fromClass = buildEvidenceBundle({
      ledger: { goal: "task", changedFiles: [] },
      failureClass: "tool_format",
    })
    expect(fromClass.recentFailures[0]?.summary).toBe(defaultFailureSummary("tool_format"))
  })
})

describe("evidence trimming and hash", () => {
  it("truncateEvidenceText", () => {
    expect(truncateEvidenceText("hello world", 8)).toBe("hello...")
  })

  it("trimEvidenceFailures/Tools 限制条目与长度", () => {
    const failures = trimEvidenceFailures(
      Array.from({ length: 15 }, (_, i) => ({
        signature: `s${i}`,
        summary: "x".repeat(300),
      })),
    )
    expect(failures).toHaveLength(10)
    expect(failures[0]!.summary.length).toBeLessThanOrEqual(200)

    const tools = trimEvidenceTools(
      Array.from({ length: 25 }, (_, i) => ({
        name: `tool${i}`,
        success: true,
        summary: "ok",
      })),
    )
    expect(tools).toHaveLength(20)
  })

  it("deriveAttemptedStrategies 去重并限长", () => {
    const strategies = deriveAttemptedStrategies(
      ["retry test", "retry test"],
      ["early_stop:read_loop", undefined, "retry test"],
    )
    expect(strategies).toEqual(["retry test", "early_stop:read_loop"])
  })

  it("hashEvidenceBundle 对等价 bundle 稳定", () => {
    const input = {
      ledger: { goal: "g", changedFiles: ["b.ts", "a.ts"] },
      failureClass: "unknown" as const,
    }
    const b1 = buildEvidenceBundle(input)
    const b2 = buildEvidenceBundle(input)
    expect(hashEvidenceBundle(b1)).toBe(hashEvidenceBundle(b2))
    expect(normalizeEvidenceForHash(b1).changedFiles).toEqual(["a.ts", "b.ts"])
  })
})
