/**
 * Eval prompt builders for Worker and Supervisor evaluation.
 */

import type { AgentBenchmarkCase } from "./types.js"

export interface EvalPromptOptions {
  objective: string
  maxRounds?: number
  tokenBudget?: number
}

/**
 * Build a prompt for Worker evaluation that instructs the worker to complete a benchmark case.
 */
export function buildWorkerEvalPrompt(
  benchmarkCase: AgentBenchmarkCase,
  options: EvalPromptOptions = { objective: "" }
): string {
  const objective = options.objective || benchmarkCase.prompt
  const maxRounds = options.maxRounds ?? 10
  const tokenBudget = options.tokenBudget ?? 0

  const parts: string[] = [
    `## Task`,
    ``,
    `Objective: ${objective}`,
    ``,
  ]

  if (benchmarkCase.repository) {
    parts.push(`### Repository`)
    parts.push(``)
    parts.push(benchmarkCase.repository)
    parts.push(``)
  }

  if (tokenBudget > 0) {
    parts.push(`### Constraints`)
    parts.push(``)
    parts.push(`Token budget: ${tokenBudget}`)
    parts.push(``)
  }

  parts.push(`### Instructions`)
  parts.push(``)
  parts.push(`Complete the objective above. Use the available tools to read, write, and edit files.`)
  parts.push(`When done, call the update_goal tool with status "complete" and a summary of what was accomplished.`)
  if (maxRounds > 0) {
    parts.push(`Maximum rounds: ${maxRounds}`)
  }

  return parts.join("\n")
}

/**
 * Build a prompt for Supervisor evaluation that instructs the supervisor to assess a worker's completion.
 */
export function buildSupervisorEvalPrompt(
  benchmarkCase: AgentBenchmarkCase,
  workerReport: string,
  options: EvalPromptOptions = { objective: "" }
): string {
  const objective = options.objective || benchmarkCase.prompt

  const parts: string[] = [
    `## Supervisor Assessment`,
    ``,
    `### Original Objective`,
    `${objective}`,
    ``,
    `### Worker Report`,
    `${workerReport || "(no report provided)"}`,
    ``,
  ]

  if (benchmarkCase.verification && benchmarkCase.verification.length > 0) {
    parts.push(`### Verification Criteria`)
    for (const criterion of benchmarkCase.verification) {
      parts.push(`- ${criterion}`)
    }
    parts.push(``)
  }

  parts.push(`### Assessment Instructions`)
  parts.push(``)
  parts.push(`Evaluate whether the worker has successfully completed the objective.`)
  parts.push(`Consider:`)
  parts.push(`- Were all verification criteria met?`)
  parts.push(`- Does the implementation match the objective requirements?`)
  parts.push(`- Are there any critical issues or gaps?`)
  parts.push(``)
  parts.push(`Respond with a JSON decision object:`)
  parts.push(`\`\`\`json`)
  parts.push(`{`)
  parts.push(`  "type": "approve" | "revise" | "blocked",`)
  parts.push(`  "reason": "brief explanation",`)
  parts.push(`  "feedback": "optional detailed feedback"`)
  parts.push(`}`)
  parts.push(`\`\`\``)

  return parts.join("\n")
}
