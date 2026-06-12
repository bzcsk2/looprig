import { describe, it, expect } from "vitest"
import {
  resolveModelTarget,
  targetFromConfig,
  targetToConfig,
  createClientForTarget,
  DEFAULT_TARGETS,
} from "../src/model-target.js"
import type { DeepreefConfig } from "../src/config.js"

const baseConfig: DeepreefConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4",
  maxTokens: 8192,
  temperature: 0.3,
  contextWindow: 128_000,
  provider: "deepseek",
}

describe("resolveModelTarget", () => {
  it("should resolve worker.local builtin target", () => {
    const target = resolveModelTarget("worker.local", baseConfig)
    expect(target).not.toBeNull()
    expect(target!.id).toBe("worker.local")
    expect(target!.role).toBe("worker")
    expect(target!.provider).toBe("openai-compatible")
    expect(target!.baseUrl).toBe("http://127.0.0.1:11434/v1")
    expect(target!.keyless).toBe(true)
  })

  it("should resolve supervisor.zen-free builtin target", () => {
    const target = resolveModelTarget("supervisor.zen-free", baseConfig)
    expect(target).not.toBeNull()
    expect(target!.role).toBe("supervisor")
    expect(target!.provider).toBe("zen")
    expect(target!.model).toBe("deepseek-v4-flash-free")
  })

  it("should return null for unknown target", () => {
    const target = resolveModelTarget("unknown.target", baseConfig)
    expect(target).toBeNull()
  })

  it("should apply project overrides", () => {
    const target = resolveModelTarget("worker.local", baseConfig, {
      "worker.local": { baseUrl: "http://localhost:8080/v1", model: "qwen2.5-coder:7b" },
    })
    expect(target!.baseUrl).toBe("http://localhost:8080/v1")
    expect(target!.model).toBe("qwen2.5-coder:7b")
  })
})

describe("targetFromConfig", () => {
  it("should create target from base config", () => {
    const target = targetFromConfig(baseConfig, "worker")
    expect(target.role).toBe("worker")
    expect(target.provider).toBe("deepseek")
    expect(target.model).toBe("deepseek-v4")
    expect(target.apiKey).toBe("test-key")
  })
})

describe("targetToConfig", () => {
  it("should convert target back to config", () => {
    const target = resolveModelTarget("supervisor.zen-free", baseConfig)!
    const config = targetToConfig(target)
    expect(config.provider).toBe("zen")
    expect(config.model).toBe("deepseek-v4-flash-free")
    expect(config.baseUrl).toBe("https://opencode.ai/zen/v1")
  })
})

describe("createClientForTarget", () => {
  it("should create independent client instance", () => {
    const target = targetFromConfig(baseConfig)
    const client1 = createClientForTarget(target)
    const client2 = createClientForTarget(target)
    expect(client1).not.toBe(client2)
  })
})

describe("DEFAULT_TARGETS", () => {
  it("should define worker, supervisor, oracle targets", () => {
    expect(DEFAULT_TARGETS["worker.local"]).toBeDefined()
    expect(DEFAULT_TARGETS["supervisor.zen-free"]).toBeDefined()
    expect(DEFAULT_TARGETS["oracle.optional"]).toBeDefined()
  })
})
