import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { STRATEGY_TIERS, TIER_ORDER, DEFAULT_TIER, getTier } from "../src/strategy/tiers.js"
import { recommendTier } from "../src/strategy/recommender.js"
import { rm, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("Strategy Tier Configuration", () => {
  it("has all four tiers", () => {
    expect(Object.keys(STRATEGY_TIERS)).toHaveLength(4)
    expect(STRATEGY_TIERS.minimal).toBeDefined()
    expect(STRATEGY_TIERS.normal).toBeDefined()
    expect(STRATEGY_TIERS.deep).toBeDefined()
    expect(STRATEGY_TIERS.exhaustive).toBeDefined()
  })

  it("tiers are ordered from least to most intensive", () => {
    expect(TIER_ORDER).toEqual(["minimal", "normal", "deep", "exhaustive"])
  })

  it("default tier is normal", () => {
    expect(DEFAULT_TIER).toBe("normal")
  })

  it("budget increases across tiers", () => {
    const budgets = TIER_ORDER.map(id => STRATEGY_TIERS[id].budgetCNY)
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]).toBeGreaterThan(budgets[i - 1])
    }
  })

  it("maxChainLength increases across tiers", () => {
    const lengths = TIER_ORDER.map(id => STRATEGY_TIERS[id].maxChainLength)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBeGreaterThan(lengths[i - 1])
    }
  })

  it("minimal tier disables reasoning", () => {
    expect(STRATEGY_TIERS.minimal.enableReasoning).toBe(false)
  })

  it("normal and above enable reasoning", () => {
    expect(STRATEGY_TIERS.normal.enableReasoning).toBe(true)
    expect(STRATEGY_TIERS.deep.enableReasoning).toBe(true)
    expect(STRATEGY_TIERS.exhaustive.enableReasoning).toBe(true)
  })

  it("getTier returns valid tier for known id", () => {
    expect(getTier("minimal").id).toBe("minimal")
    expect(getTier("deep").id).toBe("deep")
  })

  it("getTier returns default tier for unknown id", () => {
    expect(getTier("unknown")).toEqual(STRATEGY_TIERS[DEFAULT_TIER])
    expect(getTier("")).toEqual(STRATEGY_TIERS[DEFAULT_TIER])
  })

  it("every tier has required fields", () => {
    for (const tier of Object.values(STRATEGY_TIERS)) {
      expect(typeof tier.id).toBe("string")
      expect(typeof tier.label).toBe("string")
      expect(typeof tier.budgetCNY).toBe("number")
      expect(typeof tier.contextThreshold).toBe("number")
      expect(typeof tier.recommendedModel).toBe("string")
      expect(typeof tier.maxChainLength).toBe("number")
      expect(typeof tier.enableReasoning).toBe("boolean")
      expect(tier.budgetCNY).toBeGreaterThan(0)
      expect(tier.contextThreshold).toBeGreaterThan(0)
      expect(tier.contextThreshold).toBeLessThanOrEqual(1)
      expect(tier.maxChainLength).toBeGreaterThan(0)
    }
  })
})

describe("ST2: Engine tier integration", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `deepicode-st2-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const sessDir = join(tmpDir, ".deepicode", "sessions")
    await mkdir(sessDir, { recursive: true })
    const { SessionLoader } = await import("../src/session.js")
    SessionLoader.sessionDir = sessDir
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("engine starts with normal tier", async () => {
    const { ReasonixEngine } = await import("../src/engine.js")
    const config = { apiKey: "test", baseUrl: "http://localhost", model: "test", maxTokens: 1000, temperature: 0, maxContextRounds: 20, contextWindow: 128000 }
    const engine = new ReasonixEngine(config as any, undefined, "st2-test")
    expect(engine.getTier().id).toBe("normal")
  })

  it("setTier updates current tier", async () => {
    const { ReasonixEngine } = await import("../src/engine.js")
    const config = { apiKey: "test", baseUrl: "http://localhost", model: "test", maxTokens: 1000, temperature: 0, maxContextRounds: 20, contextWindow: 128000 }
    const engine = new ReasonixEngine(config as any, undefined, "st2-test")
    engine.setTier("deep")
    expect(engine.getTier().id).toBe("deep")
    expect(engine.getTier().label).toBe("Deep")
    expect(engine.getTier().maxChainLength).toBe(25)
  })

  it("resolveTierDecision resolves valid tier", async () => {
    const { ReasonixEngine } = await import("../src/engine.js")
    const config = { apiKey: "test", baseUrl: "http://localhost", model: "test", maxTokens: 1000, temperature: 0, maxContextRounds: 20, contextWindow: 128000 }
    const engine = new ReasonixEngine(config as any, undefined, "st2-test")
    engine.resolveTierDecision("minimal")
    expect(engine.getTier().id).toBe("minimal")
    expect(engine.getTier().budgetCNY).toBe(0.01)
  })

  it("resolveTierDecision falls back to default for unknown tier", async () => {
    const { ReasonixEngine } = await import("../src/engine.js")
    const config = { apiKey: "test", baseUrl: "http://localhost", model: "test", maxTokens: 1000, temperature: 0, maxContextRounds: 20, contextWindow: 128000 }
    const engine = new ReasonixEngine(config as any, undefined, "st2-test")
    engine.resolveTierDecision("nonexistent_tier")
    expect(engine.getTier().id).toBe("normal")
  })

  it("tier data accessible via public API", async () => {
    const { getTier } = await import("../src/strategy/tiers.js")
    expect(getTier("minimal").maxChainLength).toBe(2)
    expect(getTier("deep").enableReasoning).toBe(true)
    expect(getTier("exhaustive").budgetCNY).toBe(1.00)
  })
})

describe("ST4: Tier recommender", () => {

  it("stay when conditions are normal", () => {
    const result = recommendTier({
      currentTierId: "normal",
      stats: { totalCost: 0.01, promptTokens: 100, completionTokens: 50, cacheHitTokens: 10, cacheMissTokens: 5, apiCalls: 1 },
      turnCount: 2,
      toolCallsThisSubmit: 2,
      contextUsagePercent: 0.3,
      tier: getTier("normal"),
    })
    expect(result.action).toBe("stay")
  })

  it("downgrades when budget exceeded", () => {
    const result = recommendTier({
      currentTierId: "normal",
      stats: { totalCost: 0.06, promptTokens: 100, completionTokens: 50, cacheHitTokens: 10, cacheMissTokens: 5, apiCalls: 1 },
      turnCount: 2,
      toolCallsThisSubmit: 2,
      contextUsagePercent: 0.3,
      tier: getTier("normal"),
    })
    expect(result.action).toBe("downgrade")
    expect(result.suggestedTier).toBe("minimal")
  })

  it("upgrades when near max turns with high context", () => {
    const result = recommendTier({
      currentTierId: "normal",
      stats: { totalCost: 0.03, promptTokens: 100, completionTokens: 50, cacheHitTokens: 10, cacheMissTokens: 5, apiCalls: 1 },
      turnCount: 9,
      toolCallsThisSubmit: 5,
      contextUsagePercent: 0.85,
      tier: getTier("normal"),
    })
    expect(result.action).toBe("upgrade")
    expect(result.suggestedTier).toBe("deep")
  })

  it("upgrades with many tools and headroom", () => {
    const result = recommendTier({
      currentTierId: "normal",
      stats: { totalCost: 0.02, promptTokens: 100, completionTokens: 50, cacheHitTokens: 10, cacheMissTokens: 5, apiCalls: 1 },
      turnCount: 5,
      toolCallsThisSubmit: 10,
      contextUsagePercent: 0.3,
      tier: getTier("normal"),
    })
    expect(result.action).toBe("upgrade")
    expect(result.suggestedTier).toBe("deep")
  })

  it("downgrades on sustained low cost", () => {
    const result = recommendTier({
      currentTierId: "deep",
      stats: { totalCost: 0.001, promptTokens: 10, completionTokens: 5, cacheHitTokens: 0, cacheMissTokens: 0, apiCalls: 1 },
      turnCount: 5,
      toolCallsThisSubmit: 2,
      contextUsagePercent: 0.1,
      tier: getTier("deep"),
    })
    expect(result.action).toBe("downgrade")
    expect(result.suggestedTier).toBe("normal")
  })

  it("stays at minimal on budget exceeded (no lower tier)", () => {
    const result = recommendTier({
      currentTierId: "minimal",
      stats: { totalCost: 0.02, promptTokens: 100, completionTokens: 50, cacheHitTokens: 10, cacheMissTokens: 5, apiCalls: 1 },
      turnCount: 3,
      toolCallsThisSubmit: 2,
      contextUsagePercent: 0.5,
      tier: getTier("minimal"),
    })
    expect(result.action).toBe("stay")
  })

  it("stays at exhaustive on upgrade (no higher tier)", () => {
    const result = recommendTier({
      currentTierId: "exhaustive",
      stats: { totalCost: 0.5, promptTokens: 1000, completionTokens: 500, cacheHitTokens: 100, cacheMissTokens: 50, apiCalls: 1 },
      turnCount: 15,
      toolCallsThisSubmit: 20,
      contextUsagePercent: 0.9,
      tier: getTier("exhaustive"),
    })
    expect(result.action).toBe("stay")
  })
})
