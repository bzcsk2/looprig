import type { SessionStats } from "../interface.js"
import { TIER_ORDER, getTier, type StrategyTier } from "./tiers.js"

export interface TierRecommendation {
  action: "stay" | "upgrade" | "downgrade"
  suggestedTier?: string
  reason: string
}

export interface RecommenderInput {
  currentTierId: string
  stats: SessionStats
  turnCount: number
  toolCallsThisSubmit: number
  contextUsagePercent: number
  tier: StrategyTier
}

const DOWNGRADE_COST_RATIO = 0.8
const UPGRADE_TURN_RATIO = 0.7
const DOWNGRADE_LOW_COST_TURNS = 3
const DOWNGRADE_LOW_COST_RATIO = 0.15

export function recommendTier(input: RecommenderInput): TierRecommendation {
  const { currentTierId, stats, turnCount, toolCallsThisSubmit, contextUsagePercent, tier } = input

  const currentIndex = TIER_ORDER.indexOf(currentTierId as typeof TIER_ORDER[number])
  const budgetExceeded = stats.totalCost > tier.budgetCNY
  const nearBudget = stats.totalCost > tier.budgetCNY * DOWNGRADE_COST_RATIO
  const nearMaxTurns = turnCount > tier.maxChainLength * UPGRADE_TURN_RATIO
  const lowCost = stats.totalCost < tier.budgetCNY * DOWNGRADE_LOW_COST_RATIO
  const highContext = contextUsagePercent > 0.8
  const manyTools = toolCallsThisSubmit > tier.maxChainLength * 0.5

  // Immediate: over budget → downgrade
  if (budgetExceeded && currentIndex > 0) {
    const downgradeId = TIER_ORDER[currentIndex - 1]
    return { action: "downgrade", suggestedTier: downgradeId, reason: `Budget exceeded (${stats.totalCost.toFixed(4)} CNY > ${tier.budgetCNY} CNY)` }
  }

  // Near max turns + high context → upgrade
  if (nearMaxTurns && highContext && currentIndex < TIER_ORDER.length - 1) {
    const upgradeId = TIER_ORDER[currentIndex + 1]
    return { action: "upgrade", suggestedTier: upgradeId, reason: `Approaching max chain length (turn ${turnCount}/${tier.maxChainLength}) with high context usage` }
  }

  // Many tools + below budget → upgrade (need deeper analysis)
  if (manyTools && !nearBudget && currentIndex < TIER_ORDER.length - 1) {
    const upgradeId = TIER_ORDER[currentIndex + 1]
    return { action: "upgrade", suggestedTier: upgradeId, reason: `High tool usage (${toolCallsThisSubmit} calls) with budget headroom` }
  }

  // Low cost for several turns → downgrade
  if (lowCost && turnCount >= DOWNGRADE_LOW_COST_TURNS && currentIndex > 0) {
    const downgradeId = TIER_ORDER[currentIndex - 1]
    return { action: "downgrade", suggestedTier: downgradeId, reason: `Low cost usage (${stats.totalCost.toFixed(4)} CNY < ${(tier.budgetCNY * DOWNGRADE_LOW_COST_RATIO).toFixed(4)} CNY) after ${turnCount} turns` }
  }

  return { action: "stay", reason: "Current tier is appropriate" }
}

export interface TierRecommenderEvent {
  role: "tier_recommendation"
  recommendation: TierRecommendation
  metadata: {
    currentTier: string
    stats: Pick<SessionStats, "totalCost" | "promptTokens" | "completionTokens">
    turnCount: number
    toolCallsThisSubmit: number
    contextUsagePercent: number
  }
}
