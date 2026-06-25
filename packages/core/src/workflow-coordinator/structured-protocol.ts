import { z } from "zod"
import type { AgentPromptStrategyAdjustment } from "../scoring/types.js"

export const SupervisorStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  verification: z.array(z.string()).optional(),
})

export const SupervisorPlanSchema = z.object({
  version: z.literal(1),
  workflowId: z.string(),
  iteration: z.number(),
  goal: z.string(),
  summary: z.string(),
  steps: z.array(SupervisorStepSchema),
  constraints: z.array(z.string()),
  risks: z.array(z.string()),
})

export const WorkerReportVerificationSchema = z.object({
  passed: z.boolean(),
  commands: z.array(z.string()),
  summary: z.string(),
})

export const WorkerReportSchema = z.object({
  version: z.literal(1),
  workflowId: z.string(),
  iteration: z.number(),
  basedOnLedgerVersion: z.number(),
  summary: z.string(),
  completedSteps: z.array(z.string()),
  changedFiles: z.array(z.string()),
  verification: WorkerReportVerificationSchema,
  blockers: z.array(z.string()),
  requestsSupervisor: z.boolean(),
})

export const CompletionAuditItemSchema = z.object({
  requirement: z.string(),
  status: z.enum(["proven", "incomplete", "contradicted", "missing_evidence", "not_applicable"]),
  evidence: z.array(z.string()),
})

export const BlockerAuditSchema = z.object({
  blocker: z.string(),
  canMakeProgress: z.boolean(),
}).optional()

export const AgentPromptStrategyAdjustmentSchema = z.object({
  kind: z.enum([
    "decompose_task",
    "require_verification",
    "tighten_tool_policy",
    "expand_context",
    "reduce_scope",
    "increase_reporting",
    "preserve_current",
  ]),
  rationale: z.string(),
}) satisfies z.ZodType<AgentPromptStrategyAdjustment>

export const WorkerAssessmentSchema = z.object({
  summary: z.string(),
  dimensions: z.object({
    taskCompletion: z.number().min(0).max(100).optional(),
    verification: z.number().min(0).max(100).optional(),
    toolUse: z.number().min(0).max(100).optional(),
    efficiency: z.number().min(0).max(100).optional(),
    autonomy: z.number().min(0).max(100).optional(),
    instructionFollowing: z.number().min(0).max(100).optional(),
    recovery: z.number().min(0).max(100).optional(),
    communication: z.number().min(0).max(100).optional(),
    safety: z.number().min(0).max(100).optional(),
  }).partial().optional(),
  completed: z.boolean().optional(),
  verificationPassed: z.boolean().optional(),
  safetyIssue: z.boolean().optional(),
  promptStrategies: z.array(AgentPromptStrategyAdjustmentSchema).optional(),
}).optional()

export const SupervisorDecisionSchema = z.object({
  version: z.literal(1),
  workflowId: z.string(),
  iteration: z.number(),
  basedOnLedgerVersion: z.number(),
  decision: z.enum(["continue", "revise", "approve", "blocked", "ask_user"]),
  diagnosis: z.string(),
  nextActions: z.array(z.string()),
  constraints: z.array(z.string()),
  verification: z.array(z.string()),
  revisedGoal: z.string().optional(),
  question: z.string().optional(),
  completionAudit: z.array(CompletionAuditItemSchema).optional(),
  blockerAudit: BlockerAuditSchema,
  workerAssessment: WorkerAssessmentSchema,
})

export type ParsedSupervisorPlan = z.infer<typeof SupervisorPlanSchema>
export type ParsedWorkerReport = z.infer<typeof WorkerReportSchema>
export type ParsedSupervisorDecision = z.infer<typeof SupervisorDecisionSchema>

export interface BlockerAuditState {
  normalizedBlocker: string
  consecutiveTurns: number
  firstSeenAt: number
  lastSeenAt: number
}

function extractFencedJson(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  return null
}

function extractFirstJson(text: string): string | null {
  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) return braceMatch[0].trim()
  return null
}

function extractJson(text: string): string | null {
  return extractFencedJson(text) ?? extractFirstJson(text)
}

export function parseSupervisorDecision(
  text: string,
): { decision: ParsedSupervisorDecision; confidence: "high" | "low" } | null {
  const json = extractJson(text)
  if (!json) return null

  try {
    const parsed = JSON.parse(json)
    const result = SupervisorDecisionSchema.safeParse(parsed)
    if (result.success) {
      return { decision: result.data, confidence: "high" }
    }
  } catch {
    // JSON parse failed, fall through
  }

  return null
}

export function parseSupervisorPlan(
  text: string,
): { plan: ParsedSupervisorPlan; confidence: "high" | "low" } | null {
  const json = extractJson(text)
  if (!json) return null

  try {
    const parsed = JSON.parse(json)
    const result = SupervisorPlanSchema.safeParse(parsed)
    if (result.success) {
      return { plan: result.data, confidence: "high" }
    }
  } catch {
    // JSON parse failed
  }

  return null
}

export function parseWorkerReport(
  text: string,
): { report: ParsedWorkerReport; confidence: "high" | "low" } | null {
  const json = extractJson(text)
  if (!json) return null

  try {
    const parsed = JSON.parse(json)
    const result = WorkerReportSchema.safeParse(parsed)
    if (result.success) {
      return { report: result.data, confidence: "high" }
    }
  } catch {
    // JSON parse failed
  }

  return null
}
