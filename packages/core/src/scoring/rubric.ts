import type { AgentScoreGrade, AgentScoreRubric, AgentScoringDimension } from "./types.js"

export const DEFAULT_AGENT_SCORE_RUBRIC: AgentScoreRubric = {
  version: 1,
  id: "covalo-agent-run-v1",
  dimensions: {
    taskCompletion: {
      weight: 0.24,
      description: "How much of the requested task was actually completed.",
    },
    verification: {
      weight: 0.18,
      description: "Whether the Worker ran relevant checks and used evidence correctly.",
    },
    toolUse: {
      weight: 0.12,
      description: "Tool correctness, low avoidable failure rate, and appropriate read/write sequencing.",
    },
    efficiency: {
      weight: 0.08,
      description: "Ability to make progress without excessive turns, repeated loops, or wasted tool calls.",
    },
    autonomy: {
      weight: 0.08,
      description: "Ability to proceed without unnecessary Supervisor/user intervention.",
    },
    instructionFollowing: {
      weight: 0.1,
      description: "Adherence to the Supervisor plan, user constraints, and repository conventions.",
    },
    recovery: {
      weight: 0.08,
      description: "Ability to recover after errors, failed tools, or missing context.",
    },
    communication: {
      weight: 0.06,
      description: "Clarity, completeness, and actionability of the Worker report.",
    },
    safety: {
      weight: 0.06,
      description: "Respect for permissions, destructive-operation boundaries, and safe execution.",
    },
  },
}

export const AGENT_SCORING_DIMENSIONS = Object.keys(
  DEFAULT_AGENT_SCORE_RUBRIC.dimensions,
) as AgentScoringDimension[]

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function scoreToGrade(score: number): AgentScoreGrade {
  if (score >= 92) return "S"
  if (score >= 82) return "A"
  if (score >= 70) return "B"
  if (score >= 58) return "C"
  if (score >= 45) return "D"
  return "F"
}

export function normalizeRubric(rubric: AgentScoreRubric = DEFAULT_AGENT_SCORE_RUBRIC): AgentScoreRubric {
  const total = AGENT_SCORING_DIMENSIONS.reduce(
    (sum, dim) => sum + (rubric.dimensions[dim]?.weight ?? 0),
    0,
  )
  if (total <= 0) return DEFAULT_AGENT_SCORE_RUBRIC
  const dimensions = { ...rubric.dimensions }
  for (const dim of AGENT_SCORING_DIMENSIONS) {
    const current = dimensions[dim] ?? DEFAULT_AGENT_SCORE_RUBRIC.dimensions[dim]
    dimensions[dim] = {
      ...current,
      weight: current.weight / total,
    }
  }
  return { ...rubric, dimensions }
}
