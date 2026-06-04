import { describe, it, expect } from "vitest"
import { createDeepSeekCapabilities } from "../src/provider-thinking.js"
import type { ThinkingMode } from "../src/provider-thinking.js"

describe("AS1: Provider thinking capabilities", () => {
  it("declares all five thinking modes", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    expect(caps.supportedModes).toEqual(["off", "low", "medium", "high", "max"])
  })

  it("mapMode('off') disables thinking", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    const result = caps.mapMode("off")
    expect(result).toEqual({ thinking: { type: "disabled" } })
  })

  it("deepseek: mapMode('high') includes reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    const result = caps.mapMode("high")
    expect(result).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "high" })
  })

  it("deepseek: mapMode('max') includes reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    const result = caps.mapMode("max")
    expect(result).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "max" })
  })

  it("deepseek: mapMode('low') includes reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    const result = caps.mapMode("low")
    expect(result).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "low" })
  })

  it("deepseek: mapMode('medium') includes reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    const result = caps.mapMode("medium")
    expect(result).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "medium" })
  })

  it("non-deepseek: mapMode('high') does not include reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("zen")
    const result = caps.mapMode("high")
    expect(result).toEqual({ thinking: { type: "enabled" } })
    expect(result).not.toHaveProperty("reasoningEffort")
  })

  it("non-deepseek: mapMode('low') does not include reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("mimo")
    const result = caps.mapMode("low")
    expect(result).toEqual({ thinking: { type: "enabled" } })
  })

  it("all supported modes return non-null mappings", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    for (const mode of caps.supportedModes) {
      const result = caps.mapMode(mode)
      expect(result).not.toBeNull()
    }
  })
})
