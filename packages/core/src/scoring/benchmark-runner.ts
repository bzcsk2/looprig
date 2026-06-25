import { evaluateAgentRunScore } from "./evaluator.js"
import type {
  AgentBenchmarkLeaderboardEntry,
  AgentBenchmarkRunInput,
  AgentBenchmarkRunScore,
  AgentBenchmarkSuiteRunOptions,
  AgentBenchmarkSuiteRunResult,
  AgentBenchmarkSuiteSummary,
} from "./types.js"

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function rate(count: number, total: number): number {
  if (total === 0) return 0
  return count / total
}

export function scoreBenchmarkRun(input: AgentBenchmarkRunInput): AgentBenchmarkRunScore {
  const score = evaluateAgentRunScore({
    mode: "benchmark",
    benchmarkCaseId: input.case.id,
    workerModelTarget: input.workerModelTarget,
    supervisorModelTarget: input.supervisorModelTarget,
    task: input.case.prompt,
    workerReport: input.workerReport,
    completedSteps: input.completedSteps,
    plannedSteps: input.case.verification,
    changedFiles: input.changedFiles,
    verificationPassed: input.verificationPassed,
    verificationCommands: input.verificationCommands,
    blockers: input.blockers,
    toolCalls: input.toolCalls,
    toolFailures: input.toolFailures,
    loopCount: input.loopCount,
    createdAt: input.createdAt,
    supervisorAssessment: {
      summary: input.workerReport ?? `${input.case.title}: benchmark result`,
      completed: input.completed,
      verificationPassed: input.verificationPassed,
      ...input.supervisorAssessment,
    },
  })

  return {
    caseId: input.case.id,
    source: input.case.source,
    workerModelTarget: input.workerModelTarget,
    score,
    completed: input.completed,
    verificationPassed: input.verificationPassed,
    durationMs: input.durationMs,
    costUsd: input.costUsd,
    diffLinesChanged: input.diffLinesChanged,
  }
}

export async function runAgentBenchmarkSuite(
  options: AgentBenchmarkSuiteRunOptions,
): Promise<AgentBenchmarkSuiteRunResult> {
  const runs: AgentBenchmarkRunScore[] = []
  for (const workerModelTarget of options.workerModelTargets) {
    for (const benchmarkCase of options.suite.cases) {
      const input = await options.executeCase({
        case: benchmarkCase,
        workerModelTarget,
        supervisorModelTarget: options.supervisorModelTarget,
      })
      runs.push(scoreBenchmarkRun({
        ...input,
        case: benchmarkCase,
        workerModelTarget,
        supervisorModelTarget: input.supervisorModelTarget ?? options.supervisorModelTarget,
      }))
    }
  }

  const summary = summarizeBenchmarkSuite(options.suite.id, runs)
  return {
    summary,
    leaderboard: buildBenchmarkLeaderboard(summary.runs),
  }
}

export function summarizeBenchmarkSuite(
  suiteId: string,
  runs: AgentBenchmarkRunScore[],
): AgentBenchmarkSuiteSummary {
  const durationValues = runs.flatMap(run => run.durationMs === undefined ? [] : [run.durationMs])
  const costValues = runs.flatMap(run => run.costUsd === undefined ? [] : [run.costUsd])
  const diffValues = runs.flatMap(run => run.diffLinesChanged === undefined ? [] : [run.diffLinesChanged])

  return {
    suiteId,
    runs,
    averageScore: average(runs.map(run => run.score.overallScore)) ?? 0,
    completionRate: rate(runs.filter(run => run.completed).length, runs.length),
    verificationPassRate: rate(runs.filter(run => run.verificationPassed).length, runs.length),
    averageDurationMs: average(durationValues),
    totalCostUsd: costValues.length > 0 ? costValues.reduce((sum, value) => sum + value, 0) : undefined,
    averageDiffLinesChanged: average(diffValues),
  }
}

export function buildBenchmarkLeaderboard(runs: AgentBenchmarkRunScore[]): AgentBenchmarkLeaderboardEntry[] {
  const grouped = new Map<string, AgentBenchmarkRunScore[]>()
  for (const run of runs) {
    const bucket = grouped.get(run.workerModelTarget) ?? []
    bucket.push(run)
    grouped.set(run.workerModelTarget, bucket)
  }

  return [...grouped.entries()]
    .map(([workerModelTarget, modelRuns]) => {
      const durationValues = modelRuns.flatMap(run => run.durationMs === undefined ? [] : [run.durationMs])
      const costValues = modelRuns.flatMap(run => run.costUsd === undefined ? [] : [run.costUsd])
      return {
        workerModelTarget,
        runs: modelRuns.length,
        averageScore: average(modelRuns.map(run => run.score.overallScore)) ?? 0,
        completionRate: rate(modelRuns.filter(run => run.completed).length, modelRuns.length),
        verificationPassRate: rate(modelRuns.filter(run => run.verificationPassed).length, modelRuns.length),
        averageDurationMs: average(durationValues),
        totalCostUsd: costValues.length > 0 ? costValues.reduce((sum, value) => sum + value, 0) : undefined,
      }
    })
    .sort((a, b) =>
      b.averageScore - a.averageScore
      || b.verificationPassRate - a.verificationPassRate
      || b.completionRate - a.completionRate
      || (a.averageDurationMs ?? Number.POSITIVE_INFINITY) - (b.averageDurationMs ?? Number.POSITIVE_INFINITY)
      || a.workerModelTarget.localeCompare(b.workerModelTarget)
    )
}
