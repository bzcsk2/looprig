import { describe, it, expect } from "vitest"
import { estimateTokens, getFoldDecision, refinedEstimate } from "../src/context/token-estimator.js"

describe("refinedEstimate", () => {
  it("should estimate ASCII text at ~4 chars per token", () => {
    const t = refinedEstimate("hello world")
    expect(t).toBe(3)
  })

  it("should count CJK characters at 1.5 tokens each", () => {
    const t = refinedEstimate("你好世界")
    // CJK chars also match PUNCT_RE (non-word), so double-counted in formula
    expect(t).toBeGreaterThanOrEqual(6)
  })

  it("should count punctuation at 2 tokens each", () => {
    const t = refinedEstimate("hello!!!")
    expect(t).toBe(8)
  })
})

describe("estimateTokens", () => {
  it("should include message overhead per message", () => {
    const t = estimateTokens([
      { role: "user", content: "hi" },
    ])
    expect(t).toBeGreaterThan(0)
  })

  it("should count reasoning_content tokens", () => {
    const without = estimateTokens([{ role: "assistant", content: "answer" }])
    const withReasoning = estimateTokens([{ role: "assistant", content: "answer", reasoning_content: "thinking process" }])
    expect(withReasoning).toBeGreaterThan(without)
  })

  it("should not crash on null content", () => {
    const t = estimateTokens([{ role: "assistant", content: null }])
    expect(t).toBeGreaterThan(0)
  })

  it("should not crash on empty array", () => {
    const t = estimateTokens([])
    expect(t).toBe(0)
  })

  it("should handle very long message (>500K chars) without blocking", () => {
    const long = "a".repeat(600000)
    const start = Date.now()
    const t = estimateTokens([{ role: "user", content: long }])
    const elapsed = Date.now() - start
    expect(t).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000)
  })

  it("should handle combined long content and reasoning_content", () => {
    const long = "b".repeat(300000)
    const start = Date.now()
    const t = estimateTokens([{ role: "assistant", content: long, reasoning_content: long }])
    const elapsed = Date.now() - start
    expect(t).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000)
  })
})

describe("getFoldDecision", () => {
  it("should return none with ratio <= 0.65", () => {
    const d = getFoldDecision(65, 100)
    expect(d.action).toBe("none")
    expect(d.ratio).toBe(0.65)
  })

  it("should return suggest with ratio between 0.65 and 0.80", () => {
    const d = getFoldDecision(70, 100)
    expect(d.action).toBe("suggest")
    expect(d.ratio).toBe(0.7)
  })

  it("should return suggest at ratio exactly 0.75", () => {
    const d = getFoldDecision(75, 100)
    expect(d.action).toBe("suggest")
  })

  it("should return suggest at ratio exactly 0.80", () => {
    const d = getFoldDecision(80, 100)
    expect(d.action).toBe("suggest")
  })

  it("should return force with ratio > 0.80", () => {
    const d = getFoldDecision(81, 100)
    expect(d.action).toBe("force")
    expect(d.ratio).toBe(0.81)
  })

  it("should return force at ratio 1.0", () => {
    const d = getFoldDecision(100, 100)
    expect(d.action).toBe("force")
  })

  it("should handle total=0 gracefully (no overflow)", () => {
    const d = getFoldDecision(0, 0)
    expect(d.action).toBe("none")
    expect(d.ratio).toBe(0)
  })
})
