/**
 * Strategy Tier Configuration
 *
 * Four tiers define the reasoning intensity for different task complexities.
 * Pure data — no TUI imports, no side effects.
 *
 * Default behavior: when strategy module is not enabled, the engine uses
 * the current baseline (tier "normal") and does not modify request parameters.
 */

export interface StrategyTier {
  /** Unique identifier */
  id: "minimal" | "normal" | "deep" | "exhaustive"
  /** Human-readable label */
  label: string
  /** Maximum CNY budget for this tier */
  budgetCNY: number
  /** Context usage ratio threshold (0-1) above which this tier is not recommended */
  contextThreshold: number
  /** Recommended model for this tier */
  recommendedModel: string
  /** Maximum tool chain length (number of tool-call turns) */
  maxChainLength: number
  /** Whether to enable reasoning/thinking for this tier */
  enableReasoning: boolean
  /** Temperature override (null = use default) */
  temperature: number | null
}

export const STRATEGY_TIERS: Record<StrategyTier["id"], StrategyTier> = {
  minimal: {
    id: "minimal",
    label: "Minimal",
    budgetCNY: 0.01,
    contextThreshold: 0.9,
    recommendedModel: "deepseek-v4-flash",
    maxChainLength: 500,
    enableReasoning: false,
    temperature: 0.1,
  },
  normal: {
    id: "normal",
    label: "Normal",
    budgetCNY: 0.05,
    contextThreshold: 0.8,
    recommendedModel: "deepseek-v4-flash",
    maxChainLength: 500,
    enableReasoning: true,
    temperature: null, // use default
  },
  deep: {
    id: "deep",
    label: "Deep",
    budgetCNY: 0.20,
    contextThreshold: 0.7,
    recommendedModel: "deepseek-v4-reasoner",
    maxChainLength: 500,
    enableReasoning: true,
    temperature: null,
  },
  exhaustive: {
    id: "exhaustive",
    label: "Exhaustive",
    budgetCNY: 1.00,
    contextThreshold: 0.6,
    recommendedModel: "deepseek-v4-reasoner",
    maxChainLength: 500,
    enableReasoning: true,
    temperature: 0.3,
  },
}

/** Ordered tiers from least to most intensive */
export const TIER_ORDER: StrategyTier["id"][] = ["minimal", "normal", "deep", "exhaustive"]

/** Default tier when strategy module is not enabled */
export const DEFAULT_TIER: StrategyTier["id"] = "normal"

/**
 * Get a tier by id. Returns the default tier if the id is invalid.
 */
export function getTier(id: string): StrategyTier {
  return STRATEGY_TIERS[id as StrategyTier["id"]] ?? STRATEGY_TIERS[DEFAULT_TIER]
}
