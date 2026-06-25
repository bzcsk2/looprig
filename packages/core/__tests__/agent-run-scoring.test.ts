import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  AGENT_BENCHMARK_CASES,
  AgentScoreStore,
  buildBenchmarkLeaderboard,
  buildRuntimeAdjustment,
  DEFAULT_AGENT_BENCHMARK_SUITE,
  evaluateAgentRunScore,
  runAgentBenchmarkSuite,
  scoreBenchmarkRun,
  selectBenchmarkCases,
  summarizeBenchmarkSuite,
} from "../src/scoring/index.js"

describe("agent run scoring", () => {
  it("uses Supervisor dimensions and produces an actionable grade", () => {
    const score = evaluateAgentRunScore({
      mode: "live",
      workflowId: "wf-score",
      iteration: 1,
      workerModelTarget: "worker:gpt-5",
      supervisorModelTarget: "supervisor:gpt-5",
      task: "fix failing tests",
      workerReport: "Changed src/app.ts and ran npm test.",
      verificationCommands: ["npm test"],
      supervisorAssessment: {
        summary: "Worker completed the fix with adequate verification.",
        completed: true,
        verificationPassed: true,
        dimensions: {
          taskCompletion: 94,
          verification: 91,
          communication: 78,
        },
      },
    })

    expect(score.overallScore).toBeGreaterThan(80)
    expect(["S", "A", "B"]).toContain(score.grade)
    expect(score.dimensions.find(d => d.dimension === "taskCompletion")?.score).toBe(94)
    expect(score.evidence.summary).toContain("adequate verification")
  })

  it("penalizes missing verification and recommends tighter strategy", () => {
    const score = evaluateAgentRunScore({
      mode: "live",
      workflowId: "wf-score",
      iteration: 4,
      workerModelTarget: "worker:small-model",
      task: "finish the migration",
      workerReport: "I am blocked.",
      plannedSteps: ["read config", "edit migration", "run tests"],
      completedSteps: ["read config"],
      blockers: ["tests not run"],
      verificationPassed: false,
      toolFailures: 2,
      toolCalls: 4,
    })

    expect(score.overallScore).toBeLessThan(70)
    expect(score.adjustment.recommendedHarness).toBe("strict")
    expect(score.adjustment.recommendedThinking).toBe("high")
    expect(score.adjustment.promptStrategies.map(s => s.kind)).toEqual(
      expect.arrayContaining(["decompose_task", "require_verification", "tighten_tool_policy"]),
    )
  })

  it("builds preservation guidance for strong runs", () => {
    const score = evaluateAgentRunScore({
      mode: "benchmark",
      benchmarkCaseId: "human-eval-function-synthesis",
      workerModelTarget: "worker:gpt-5",
      task: "implement a function",
      workerReport: "Implemented and verified with unit tests.",
      completedSteps: ["implement", "test"],
      plannedSteps: ["implement", "test"],
      verificationPassed: true,
      verificationCommands: ["pytest -q"],
      toolCalls: 3,
    })
    const adjustment = buildRuntimeAdjustment(score)

    expect(adjustment.recommendedHarness).toBe("loose")
    expect(adjustment.promptStrategies.map(s => s.kind)).toContain("preserve_current")
  })

  it("persists scores by workflow", () => {
    const basePath = mkdtempSync(join(tmpdir(), "deepreef-score-"))
    try {
      const store = new AgentScoreStore({ basePath })
      const score = evaluateAgentRunScore({
        mode: "live",
        workflowId: "wf/score test",
        iteration: 1,
        workerModelTarget: "worker:gpt-5",
        task: "persist score",
        workerReport: "done",
        verificationPassed: true,
      })

      store.append(score)

      expect(store.list("wf/score test")).toHaveLength(1)
      expect(store.latest("wf/score test")?.id).toBe(score.id)
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it("includes public benchmark and agent-eval inspired cases", () => {
    expect(DEFAULT_AGENT_BENCHMARK_SUITE.cases.length).toBe(AGENT_BENCHMARK_CASES.length)
    const sources = AGENT_BENCHMARK_CASES.map(c => c.source)
    expect(sources).toEqual(expect.arrayContaining([
      "swe-bench",
      "human-eval",
      "mbpp",
      "repo-bench",
      "codejoust",
      "litebench",
      "agentprobe",
      "issuebenchkit",
      "deepreef-regression",
    ]))
    expect(selectBenchmarkCases(["tool-trace"]).map(c => c.id)).toEqual(
      expect.arrayContaining(["litebench-style-agent-rollout", "agentprobe-style-regression"]),
    )
    expect(AGENT_BENCHMARK_CASES.every(c => c.evaluationSignals.length > 0)).toBe(true)
  })

  it("scores benchmark runs and builds a model leaderboard", () => {
    const caseA = AGENT_BENCHMARK_CASES.find(c => c.id === "codejoust-style-agent-race")!
    const caseB = AGENT_BENCHMARK_CASES.find(c => c.id === "agentprobe-style-regression")!
    const strong = scoreBenchmarkRun({
      case: caseA,
      workerModelTarget: "worker:strong",
      completed: true,
      verificationPassed: true,
      workerReport: "Completed the issue and passed bun test.",
      completedSteps: caseA.verification,
      changedFiles: ["src/fix.ts"],
      verificationCommands: ["bun test"],
      toolCalls: 5,
      toolFailures: 0,
      loopCount: 1,
      durationMs: 10_000,
      costUsd: 0.02,
      diffLinesChanged: 32,
    })
    const weak = scoreBenchmarkRun({
      case: caseA,
      workerModelTarget: "worker:weak",
      completed: false,
      verificationPassed: false,
      workerReport: "Stopped before running tests.",
      blockers: ["missing verification"],
      toolCalls: 8,
      toolFailures: 4,
      loopCount: 4,
      durationMs: 30_000,
      costUsd: 0.01,
      diffLinesChanged: 120,
    })
    const strongRegression = scoreBenchmarkRun({
      case: caseB,
      workerModelTarget: "worker:strong",
      completed: true,
      verificationPassed: true,
      workerReport: "Snapshot and semantic assertions passed.",
      completedSteps: caseB.verification,
      verificationCommands: ["bun test agentprobe"],
      toolCalls: 3,
      toolFailures: 0,
      durationMs: 8_000,
      costUsd: 0.015,
      diffLinesChanged: 0,
    })

    const summary = summarizeBenchmarkSuite("suite-test", [strong, weak, strongRegression])
    const leaderboard = buildBenchmarkLeaderboard(summary.runs)

    expect(strong.score.mode).toBe("benchmark")
    expect(strong.score.benchmarkCaseId).toBe("codejoust-style-agent-race")
    expect(summary.averageScore).toBeGreaterThan(0)
    expect(summary.completionRate).toBeCloseTo(2 / 3, 5)
    expect(summary.verificationPassRate).toBeCloseTo(2 / 3, 5)
    expect(summary.totalCostUsd).toBeCloseTo(0.045, 5)
    expect(leaderboard[0].workerModelTarget).toBe("worker:strong")
    expect(leaderboard[0].runs).toBe(2)
    expect(leaderboard[0].averageScore).toBeGreaterThan(leaderboard[1].averageScore)
  })

  it("runs a benchmark suite across Worker model targets with an injected executor", async () => {
    const cases = selectBenchmarkCases(["codejoust"]).slice(0, 1)
    const result = await runAgentBenchmarkSuite({
      suite: {
        ...DEFAULT_AGENT_BENCHMARK_SUITE,
        id: "suite-auto",
        cases,
      },
      workerModelTargets: ["worker:small", "worker:large"],
      supervisorModelTarget: "supervisor:judge",
      executeCase: async ({ case: benchmarkCase, workerModelTarget, supervisorModelTarget }) => ({
        case: benchmarkCase,
        workerModelTarget,
        supervisorModelTarget,
        completed: workerModelTarget.endsWith("large"),
        verificationPassed: workerModelTarget.endsWith("large"),
        workerReport: `${workerModelTarget} attempted ${benchmarkCase.id}`,
        verificationCommands: workerModelTarget.endsWith("large") ? ["benchmark validate"] : [],
        supervisorAssessment: {
          summary: `${supervisorModelTarget} judged ${workerModelTarget}`,
          completed: workerModelTarget.endsWith("large"),
          verificationPassed: workerModelTarget.endsWith("large"),
          dimensions: {
            taskCompletion: workerModelTarget.endsWith("large") ? 92 : 40,
            verification: workerModelTarget.endsWith("large") ? 88 : 20,
          },
        },
      }),
    })

    expect(result.summary.runs).toHaveLength(2)
    expect(result.summary.completionRate).toBe(0.5)
    expect(result.leaderboard[0].workerModelTarget).toBe("worker:large")
    expect(result.summary.runs[0].score.supervisorModelTarget).toBe("supervisor:judge")
    expect(result.summary.runs[0].score.evidence.summary).toContain("supervisor:judge judged")
  })
})
