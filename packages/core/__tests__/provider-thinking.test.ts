import { describe, it, expect } from "vitest"
import { createDeepSeekCapabilities } from "../src/provider-thinking.js"

describe("AS1: Provider thinking capabilities", () => {
  it("declares all four thinking modes", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    expect(caps.supportedModes).toEqual(["off", "open", "high", "auto"])
  })

  it("mapMode('off') disables thinking", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    expect(caps.mapMode("off")).toEqual({ thinking: { type: "disabled" } })
  })

  it("mapMode('auto') enables thinking without effort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    expect(caps.mapMode("auto")).toEqual({ thinking: { type: "enabled" } })
  })

  it("deepseek: mapMode('open') enables thinking without reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    expect(caps.mapMode("open")).toEqual({ thinking: { type: "enabled" } })
  })

  it("deepseek: mapMode('high') includes reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    expect(caps.mapMode("high")).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "high" })
  })

  it("non-deepseek: mapMode('open') does not include reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("zen")
    expect(caps.mapMode("open")).toEqual({ thinking: { type: "enabled" } })
  })

  it("non-deepseek: mapMode('high') does not include reasoningEffort", () => {
    const caps = createDeepSeekCapabilities("mimo")
    const result = caps.mapMode("high")
    expect(result).toEqual({ thinking: { type: "enabled" } })
    expect(result).not.toHaveProperty("reasoningEffort")
  })

  it("all supported modes return non-null mappings", () => {
    const caps = createDeepSeekCapabilities("deepseek")
    for (const mode of caps.supportedModes) {
      expect(caps.mapMode(mode)).not.toBeNull()
    }
  })
})
