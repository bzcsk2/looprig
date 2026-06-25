/**
 * Eval runner for executing benchmark cases through the agent system.
 */

import type { AgentBenchmarkCase, AgentBenchmarkRunScore, AgentBenchmarkLeaderboardEntry } from "./types.js"

export interface EvalRunOptions {
  /** Models to evaluate */
  models: string[]
  /** Benchmark cases to run */
  cases: AgentBenchmarkCase[]
  /** Maximum number of cases per model */
  limit?: number
  /** Whether to run in dry-run mode */
  dryRun?: boolean
}

export interface EvalRunProgress {
  /** Current status */
  status: "setup" | "running" | "passed" | "failed" | "skipped" | "complete"
  /** Current case ID */
  caseId?: string
  /** Current case index (0-based) */
  index?: number
  /** Total cases */
  total?: number
  /** Worker model being evaluated */
  workerModelTarget?: string
  /** Skip reason if status is 'skipped' */
  reason?: string
  /** Score if status is 'passed' or 'failed' */
  score?: {
    overallScore: number
    grade: string
  }
}

export interface EvalRunResult {
  /** Unique eval run ID */
  evalRunId: string
  /** Directory where the report is saved */
  reportDir: string
  /** Leaderboard entries */
  leaderboard: AgentBenchmarkLeaderboardEntry[]
  /** All run scores */
  runs: AgentBenchmarkRunScore[]
}

export type WorkerExecutor = (params: {
  prompt: string
  signal?: AbortSignal
}) => Promise<{ text: string; toolCalls: number; toolFailures: number; durationMs: number }>

export type SupervisorExecutor = (params: {
  prompt: string
  signal?: AbortSignal
}) => Promise<{ text: string; durationMs: number }>

export type ModelSwitchFn = (modelTarget: string) => Promise<void>
export type ModelRestoreFn = () => Promise<void>

/**
 * Run eval cases through the agent system.
 */
export async function runEval(
  options: EvalRunOptions,
  executors: {
    switchModel: ModelSwitchFn
    restoreModel: ModelRestoreFn
    executeWorker: WorkerExecutor
    executeSupervisor: SupervisorExecutor
  },
  onProgress?: (progress: EvalRunProgress) => void,
): Promise<EvalRunResult> {
  const { models, cases, limit, dryRun = false } = options
  const { switchModel, restoreModel, executeWorker, executeSupervisor } = executors

  const evalRunId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const reportDir = `.deepreef/eval-runs/${evalRunId}`

  const allRuns: AgentBenchmarkRunScore[] = []
  let caseIndex = 0

  const reportProgress = (progress: EvalRunProgress) => {
    onProgress?.(progress)
  }

  reportProgress({ status: "setup" })

  for (const model of models) {
    const casesToRun = limit ? cases.slice(0, limit) : cases

    for (const benchmarkCase of casesToRun) {
      caseIndex++

      if (dryRun) {
        reportProgress({
          status: "skipped",
          index: caseIndex,
          total: models.length * casesToRun.length,
          workerModelTarget: model,
          caseId: benchmarkCase.id,
          reason: "dry-run",
        })
        continue
      }

      reportProgress({
        status: "running",
        index: caseIndex,
        total: models.length * casesToRun.length,
        workerModelTarget: model,
        caseId: benchmarkCase.id,
      })

      try {
        await switchModel(model)

        const workerPrompt = `Complete the following task:\n\n${benchmarkCase.prompt}\n\nWhen done, provide a summary of what was accomplished.`
        const workerResult = await executeWorker({ prompt: workerPrompt })

        const supervisorPrompt = `Assess whether the worker completed the following task:\n\nTask: ${benchmarkCase.prompt}\n\nWorker report:\n${workerResult.text}\n\nExpected verification:\n${benchmarkCase.verification.join("\n")}`
        const supervisorResult = await executeSupervisor({ prompt: supervisorPrompt })

        const success = workerResult.text.length > 0 && !workerResult.text.toLowerCase().includes("error")

        const runScore: AgentBenchmarkRunScore = {
          caseId: benchmarkCase.id,
          source: benchmarkCase.source,
          workerModelTarget: model,
          score: {
            version: 1,
            id: `score-${benchmarkCase.id}-${model}`,
            mode: "benchmark",
            benchmarkCaseId: benchmarkCase.id,
            workerModelTarget: model,
            task: benchmarkCase.title,
            dimensions: [],
            overallScore: success ? 80 : 20,
            grade: success ? "B" : "F",
            evidence: {
              summary: workerResult.text.slice(0, 200),
            },
            adjustment: {
              promptStrategies: [],
            },
            createdAt: Date.now(),
          },
          completed: success,
          verificationPassed: success,
          durationMs: workerResult.durationMs + supervisorResult.durationMs,
        }

        allRuns.push(runScore)

        reportProgress({
          status: success ? "passed" : "failed",
          index: caseIndex,
          total: models.length * casesToRun.length,
          workerModelTarget: model,
          caseId: benchmarkCase.id,
          score: {
            overallScore: runScore.score.overallScore,
            grade: runScore.score.grade,
          },
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        const runScore: AgentBenchmarkRunScore = {
          caseId: benchmarkCase.id,
          source: benchmarkCase.source,
          workerModelTarget: model,
          score: {
            version: 1,
            id: `score-${benchmarkCase.id}-${model}`,
            mode: "benchmark",
            benchmarkCaseId: benchmarkCase.id,
            workerModelTarget: model,
            task: benchmarkCase.title,
            dimensions: [],
            overallScore: 0,
            grade: "F",
            evidence: {
              summary: `Error: ${errorMsg}`,
            },
            adjustment: {
              promptStrategies: [],
            },
            createdAt: Date.now(),
          },
          completed: false,
          verificationPassed: false,
          durationMs: 0,
        }

        allRuns.push(runScore)

        reportProgress({
          status: "failed",
          index: caseIndex,
          total: models.length * casesToRun.length,
          workerModelTarget: model,
          caseId: benchmarkCase.id,
        })
      }
    }
  }

  await restoreModel()

  const leaderboard = buildLeaderboard(allRuns)

  reportProgress({ status: "complete" })

  return {
    evalRunId,
    reportDir,
    leaderboard,
    runs: allRuns,
  }
}

function buildLeaderboard(runs: AgentBenchmarkRunScore[]): AgentBenchmarkLeaderboardEntry[] {
  const byModel = new Map<string, AgentBenchmarkRunScore[]>()

  for (const run of runs) {
    const existing = byModel.get(run.workerModelTarget) || []
    existing.push(run)
    byModel.set(run.workerModelTarget, existing)
  }

  const entries: AgentBenchmarkLeaderboardEntry[] = []

  for (const [model, modelRuns] of byModel) {
    const completedRuns = modelRuns.filter(r => r.completed)
    const verifiedRuns = modelRuns.filter(r => r.verificationPassed)

    entries.push({
      workerModelTarget: model,
      runs: modelRuns.length,
      averageScore: modelRuns.reduce((sum, r) => sum + r.score.overallScore, 0) / modelRuns.length,
      completionRate: completedRuns.length / modelRuns.length,
      verificationPassRate: verifiedRuns.length / modelRuns.length,
      averageDurationMs: modelRuns.reduce((sum, r) => sum + (r.durationMs || 0), 0) / modelRuns.length,
    })
  }

  entries.sort((a, b) => b.averageScore - a.averageScore)

  return entries
}
