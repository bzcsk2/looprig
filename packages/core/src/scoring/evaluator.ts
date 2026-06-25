import { randomUUID } from "node:crypto"
import type {
  AgentRunScore,
  AgentRunScoreInput,
  AgentRuntimeAdjustment,
  AgentScoreDimensionResult,
  AgentScoreRubric,
  AgentScoringDimension,
} from "./types.js"
import {
  AGENT_SCORING_DIMENSIONS,
  DEFAULT_AGENT_SCORE_RUBRIC,
  clampScore,
  normalizeRubric,
  scoreToGrade,
} from "./rubric.js"

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.max(0, Math.min(1, numerator / denominator))
}

function inferCompletion(input: AgentRunScoreInput): number {
  if (input.supervisorAssessment?.completed === true) return 92
  if (input.supervisorAssessment?.completed === false) return 35
  const planned = input.plannedSteps?.length ?? 0
  const completed = input.completedSteps?.length ?? 0
  if (planned > 0) return 35 + ratio(completed, planned) * 60
  if (input.verificationPassed) return 82
  if ((input.blockers?.length ?? 0) > 0) return 45
  return input.workerReport?.trim() ? 60 : 25
}

function inferVerification(input: AgentRunScoreInput): number {
  if (input.supervisorAssessment?.verificationPassed === true) return 92
  if (input.supervisorAssessment?.verificationPassed === false) return 35
  if (input.verificationPassed === true) return 88
  if (input.verificationPassed === false) return 30
  const commandCount = input.verificationCommands?.length ?? 0
  return commandCount > 0 ? 65 : 35
}

function inferToolUse(input: AgentRunScoreInput): number {
  const toolCalls = input.toolCalls ?? 0
  const failures = input.toolFailures ?? 0
  if (toolCalls === 0) return input.mode === "benchmark" ? 45 : 65
  const failureRate = ratio(failures, toolCalls)
  return clampScore(92 - failureRate * 75)
}

function inferEfficiency(input: AgentRunScoreInput): number {
  const loopCount = input.loopCount ?? input.iteration ?? 1
  if (loopCount <= 1) return 88
  if (loopCount <= 3) return 78
  if (loopCount <= 6) return 65
  if (loopCount <= 10) return 50
  return 35
}

function inferAutonomy(input: AgentRunScoreInput): number {
  const blockers = input.blockers?.length ?? 0
  if (blockers === 0) return 82
  if (blockers === 1) return 62
  return 42
}

function inferInstructionFollowing(input: AgentRunScoreInput): number {
  const planned = input.plannedSteps?.length ?? 0
  const completed = input.completedSteps?.length ?? 0
  if (planned > 0) return clampScore(45 + ratio(completed, planned) * 45)
  return input.workerReport?.trim() ? 70 : 40
}

function inferRecovery(input: AgentRunScoreInput): number {
  const failures = input.toolFailures ?? 0
  const blockers = input.blockers?.length ?? 0
  if (failures === 0 && blockers === 0) return 78
  if (input.verificationPassed || input.supervisorAssessment?.completed) return 72
  if (failures > 0 && blockers === 0) return 58
  return 42
}

function inferCommunication(input: AgentRunScoreInput): number {
  const text = input.workerReport?.trim() ?? ""
  if (!text) return 25
  const hasEvidence = (input.verificationCommands?.length ?? 0) > 0 || /test|verify|验证|检查/i.test(text)
  const hasFiles = (input.changedFiles?.length ?? 0) > 0 || /file|changed|修改|文件/i.test(text)
  return clampScore(52 + (hasEvidence ? 22 : 0) + (hasFiles ? 16 : 0) + Math.min(text.length / 40, 10))
}

function inferSafety(input: AgentRunScoreInput): number {
  if (input.supervisorAssessment?.safetyIssue === true) return 20
  const report = input.workerReport ?? ""
  if (/bypass|disable security|ignore permission|绕过.*权限|忽略.*安全/i.test(report)) return 25
  return 86
}

function inferDimensionScore(dim: AgentScoringDimension, input: AgentRunScoreInput): number {
  const supervisorValue = input.supervisorAssessment?.dimensions?.[dim]
  if (supervisorValue !== undefined) return clampScore(supervisorValue)
  switch (dim) {
    case "taskCompletion": return inferCompletion(input)
    case "verification": return inferVerification(input)
    case "toolUse": return inferToolUse(input)
    case "efficiency": return inferEfficiency(input)
    case "autonomy": return inferAutonomy(input)
    case "instructionFollowing": return inferInstructionFollowing(input)
    case "recovery": return inferRecovery(input)
    case "communication": return inferCommunication(input)
    case "safety": return inferSafety(input)
  }
}

function defaultRationale(dim: AgentScoringDimension, score: number): string {
  if (score >= 82) return `${dim} is strong for this run.`
  if (score >= 60) return `${dim} is acceptable but should be watched.`
  return `${dim} is weak and should influence the next Worker strategy.`
}

export function buildRuntimeAdjustment(score: AgentRunScore): AgentRuntimeAdjustment {
  const dim = Object.fromEntries(score.dimensions.map(d => [d.dimension, d.score])) as Record<AgentScoringDimension, number>
  const promptStrategies = [...score.adjustment.promptStrategies]

  if (score.overallScore >= 82) {
    promptStrategies.push({ kind: "preserve_current", rationale: "Worker performed well; avoid unnecessary prompt churn." })
  }
  if (dim.taskCompletion < 65 || dim.instructionFollowing < 65) {
    promptStrategies.push({ kind: "decompose_task", rationale: "Worker missed planned work or drifted from instructions." })
  }
  if (dim.verification < 70) {
    promptStrategies.push({ kind: "require_verification", rationale: "Verification evidence was weak or missing." })
  }
  if (dim.toolUse < 65 || dim.safety < 70) {
    promptStrategies.push({ kind: "tighten_tool_policy", rationale: "Tool failures or safety risk require stricter rails." })
  }
  if (dim.communication < 60) {
    promptStrategies.push({ kind: "increase_reporting", rationale: "Worker report was too sparse for Supervisor review." })
  }

  return {
    recommendedHarness: score.overallScore < 58 ? "strict" : score.overallScore >= 82 ? "loose" : "normal",
    recommendedThinking: score.overallScore < 65 ? "high" : undefined,
    recommendedMaxTokens: dim.communication < 50 ? 4096 : undefined,
    promptStrategies,
  }
}

export function evaluateAgentRunScore(
  input: AgentRunScoreInput,
  rubric: AgentScoreRubric = DEFAULT_AGENT_SCORE_RUBRIC,
): AgentRunScore {
  const normalizedRubric = normalizeRubric(rubric)
  const dimensions: AgentScoreDimensionResult[] = AGENT_SCORING_DIMENSIONS.map((dimension) => {
    const score = inferDimensionScore(dimension, input)
    return {
      dimension,
      score,
      weight: normalizedRubric.dimensions[dimension].weight,
      rationale: defaultRationale(dimension, score),
    }
  })

  const overallScore = clampScore(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
  )

  const score: AgentRunScore = {
    version: 1,
    id: randomUUID(),
    mode: input.mode,
    workflowId: input.workflowId,
    iteration: input.iteration,
    benchmarkCaseId: input.benchmarkCaseId,
    workerModelTarget: input.workerModelTarget,
    supervisorModelTarget: input.supervisorModelTarget,
    task: input.task,
    dimensions,
    overallScore,
    grade: scoreToGrade(overallScore),
    evidence: {
      summary: input.supervisorAssessment?.summary ?? input.workerReport?.slice(0, 1000) ?? "",
      passedVerification: input.supervisorAssessment?.verificationPassed ?? input.verificationPassed,
      completedSteps: input.completedSteps,
      missingSteps: input.plannedSteps?.filter(step => !(input.completedSteps ?? []).includes(step)),
      changedFiles: input.changedFiles,
      commands: input.verificationCommands,
      failures: input.blockers,
    },
    adjustment: {
      promptStrategies: input.supervisorAssessment?.promptStrategies ?? [],
    },
    createdAt: input.createdAt ?? Date.now(),
  }

  score.adjustment = buildRuntimeAdjustment(score)
  return score
}
