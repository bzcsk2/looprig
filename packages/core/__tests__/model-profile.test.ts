import { describe, it, expect } from "vitest"
import {
  matchModelProfile,
  resolveModelProfile,
  resolveHarnessProfile,
  resolveDefaultHarness,
  BUILTIN_HARNESS_PROFILES,
} from "../src/model-profile/index.js"

describe("matchModelProfile", () => {
  it("should match qwen3-8b by model name", () => {
    const profile = matchModelProfile("qwen3-8b-instruct")
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe("qwen3-8b")
    expect(profile!.toolFormat).toBe("hermes")
  })

  it("should match qwen2.5-coder-14b", () => {
    const profile = matchModelProfile("qwen2.5-coder:14b")
    expect(profile!.id).toBe("qwen2.5-coder-14b")
    expect(profile!.defaultHarness).toBe("local-medium-forced")
  })

  it("should match devstral-small", () => {
    const profile = matchModelProfile("devstral-small-latest")
    expect(profile!.id).toBe("devstral-small")
    expect(profile!.toolFormat).toBe("native")
  })

  it("should return null for unknown model", () => {
    expect(matchModelProfile("totally-unknown-model-xyz")).toBeNull()
  })
})

describe("resolveModelProfile", () => {
  it("should use conservative default for unknown local model", () => {
    const profile = resolveModelProfile("unknown-local-7b", true)
    expect(profile.id).toBe("unknown-local")
    expect(profile.sizeClass).toBe("small")
    expect(profile.defaultHarness).toBe("local-small-strict")
  })

  it("should use remote default for unknown remote model", () => {
    const profile = resolveModelProfile("unknown-remote-model", false)
    expect(profile.id).toBe("unknown-remote")
    expect(profile.defaultHarness).toBe("remote-adaptive")
  })

  it("should apply detected context window", () => {
    const profile = resolveModelProfile("qwen3-8b", true, 64_000)
    expect(profile.contextWindow).toBe(64_000)
  })

  it("should apply project overrides", () => {
    const profile = resolveModelProfile("qwen3-8b", true, 0, {
      modelProfiles: {
        "qwen3-8b": { maxOutputTokens: 2048 },
      },
    })
    expect(profile.maxOutputTokens).toBe(2048)
  })
})

describe("resolveHarnessProfile", () => {
  it("should resolve local-small-strict harness", () => {
    const harness = resolveHarnessProfile("local-small-strict")
    expect(harness.toolset).toBe("minimal")
    expect(harness.maxParallelTools).toBe(2)
    expect(harness.requireReadBeforeWrite).toBe(true)
  })

  it("should resolve supervisor-advice-only harness", () => {
    const harness = resolveHarnessProfile("supervisor-advice-only")
    expect(harness.toolset).toBe("none")
    expect(harness.supervisorPolicy).toBe("off")
  })

  it("should fallback to remote-adaptive for unknown harness", () => {
    const harness = resolveHarnessProfile("nonexistent")
    expect(harness.id).toBe("remote-adaptive")
  })

  it("should apply harness overrides", () => {
    const harness = resolveHarnessProfile("local-small-strict", {
      harnessProfiles: {
        "local-small-strict": { maxTurns: 10 },
      },
    })
    expect(harness.maxTurns).toBe(10)
  })
})

describe("resolveDefaultHarness", () => {
  it("should resolve harness from model profile", () => {
    const harness = resolveDefaultHarness("qwen2.5-coder:14b", true)
    expect(harness.id).toBe("local-medium-forced")
    expect(harness.toolset).toBe("coding")
  })
})

describe("BUILTIN_HARNESS_PROFILES", () => {
  it("should define all required harness profiles", () => {
    expect(BUILTIN_HARNESS_PROFILES["local-small-strict"]).toBeDefined()
    expect(BUILTIN_HARNESS_PROFILES["local-medium-forced"]).toBeDefined()
    expect(BUILTIN_HARNESS_PROFILES["remote-adaptive"]).toBeDefined()
    expect(BUILTIN_HARNESS_PROFILES["supervisor-advice-only"]).toBeDefined()
    expect(BUILTIN_HARNESS_PROFILES["free-chat"]).toBeDefined()
  })
})
