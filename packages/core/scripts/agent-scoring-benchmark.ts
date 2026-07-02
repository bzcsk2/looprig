#!/usr/bin/env bun
/**
 * Agent run-level scoring benchmark smoke runner.
 *
 * This script does not invoke real models. It exercises the scoring benchmark
 * catalog, suite summary, and leaderboard pipeline with deterministic mock
 * outcomes so CI/local checks can validate the scoring control surface.
 *
 * Usage:
 *   bun run packages/core/scripts/agent-scoring-benchmark.ts
 *   bun run packages/core/scripts/agent-scoring-benchmark.ts --tag tool-trace
 *   bun run packages/core/scripts/agent-scoring-benchmark.ts --models local-8b,remote-medium
 */

import {
  DEFAULT_AGENT_BENCHMARK_SUITE,
  buildBenchmarkLeaderboard,
  scoreBenchmarkRun,
  selectBenchmarkCases,
  summarizeBenchmarkSuite,
  type AgentBenchmarkCase,
} from "../src/scoring/index.js"

const args = process.argv.slice(2)

function argValue(name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

function splitCsv(value: string | undefined): string[] {
  return value?.split(",").map(v => v.trim()).filter(Boolean) ?? []
}

function deterministicOutcome(model: string, benchmarkCase: AgentBenchmarkCase, index: number) {
  const modelBoost = model.includes("remote") || model.includes("strong") ? 18 : model.includes("local-8b") ? -8 : 4
  const difficultyPenalty = benchmarkCase.difficulty === "hard" ? 18 : benchmarkCase.difficulty === "medium" ? 10 : 2
  const sourcePenalty = benchmarkCase.source === "issuebenchkit" || benchmarkCase.source === "swe-bench" ? 6 : 0
  const raw = 68 + modelBoost - difficultyPenalty - sourcePenalty + ((index * 7) % 13)
  const completed = raw >= 58
  const verificationPassed = raw >= 66
  const toolFailures = raw >= 75 ? 0 : raw >= 60 ? 1 : 3

  return {
    completed,
    verificationPassed,
    toolFailures,
    toolCalls: 4 + (index % 5),
    loopCount: raw >= 75 ? 1 : raw >= 60 ? 2 : 4,
    durationMs: 8000 + difficultyPenalty * 1000 + toolFailures * 2500,
    costUsd: model.includes("remote") ? 0.02 + index * 0.001 : 0,
    diffLinesChanged: completed ? 20 + difficultyPenalty : 90 + difficultyPenalty,
  }
}

function main(): void {
  const tags = splitCsv(argValue("--tag"))
  const models = splitCsv(argValue("--models"))
  const selectedModels = models.length > 0 ? models : ["local-8b", "local-14b-20b", "remote-medium"]
  const cases = selectBenchmarkCases(tags)

  const runs = selectedModels.flatMap((model) =>
    cases.map((benchmarkCase, index) => {
      const outcome = deterministicOutcome(model, benchmarkCase, index)
      return scoreBenchmarkRun({
        case: benchmarkCase,
        workerModelTarget: model,
        completed: outcome.completed,
        verificationPassed: outcome.verificationPassed,
        workerReport: outcome.verificationPassed
          ? `Completed ${benchmarkCase.title} and verification passed.`
          : `Attempted ${benchmarkCase.title}; verification is incomplete.`,
        completedSteps: outcome.completed ? benchmarkCase.verification : benchmarkCase.verification.slice(0, 1),
        verificationCommands: outcome.verificationPassed ? ["benchmark validate"] : [],
        blockers: outcome.verificationPassed ? [] : ["verification incomplete"],
        toolCalls: outcome.toolCalls,
        toolFailures: outcome.toolFailures,
        loopCount: outcome.loopCount,
        durationMs: outcome.durationMs,
        costUsd: outcome.costUsd,
        diffLinesChanged: outcome.diffLinesChanged,
      })
    })
  )

  const summary = summarizeBenchmarkSuite(DEFAULT_AGENT_BENCHMARK_SUITE.id, runs)
  const leaderboard = buildBenchmarkLeaderboard(summary.runs)

  console.log("Covalo Agent Scoring Benchmark")
  console.log(`suite=${summary.suiteId}`)
  console.log(`cases=${cases.length} models=${selectedModels.length} runs=${runs.length}`)
  console.log(`averageScore=${summary.averageScore.toFixed(1)} completion=${(summary.completionRate * 100).toFixed(1)}% verification=${(summary.verificationPassRate * 100).toFixed(1)}%`)
  if (summary.totalCostUsd !== undefined) {
    console.log(`totalCostUsd=${summary.totalCostUsd.toFixed(4)}`)
  }

  console.log("\nLeaderboard")
  for (const [index, entry] of leaderboard.entries()) {
    console.log(`${index + 1}. ${entry.workerModelTarget} score=${entry.averageScore.toFixed(1)} verification=${(entry.verificationPassRate * 100).toFixed(1)}% runs=${entry.runs}`)
  }
}

main()
