/**
 * 两阶段工具路由模块入口
 *
 * DRF-70
 */

export type {
  ToolCategory,
  ToolRoutingMode,
  ToolRoutingStage,
  ToolRoutingDecision,
  ToolRoutingContext,
  ToolCategoryDef,
} from "./types.js"

export {
  TOOL_CATEGORIES,
  TWO_STAGE_CONTEXT_THRESHOLD,
  DEFAULT_SCHEMA_BUDGET_RATIO,
  MIN_SCHEMA_TOKEN_BUDGET,
  getRoutingMode,
  estimateToolSchemaTokens,
  resolveSchemaTokenBudget,
  shouldUseTwoStageRouting,
  inferToolCategory,
  applyDeterministicCategoryFilter,
  getCategorySelectorTool,
  getToolsForCategory,
  estimateRoutingSavings,
  parseSelectedCategory,
  resolveToolRouting,
  categoriesForToolset,
} from "./two-stage-router.js"
