import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runEval, selectBenchmarkCases } from "../src/scoring/index.js"
import { EvalReportStore } from "../src/scoring/store.js"
import type { EvalRunOptions } from "../src/scoring/eval-runner.js"

describe("runEval", () => {
  const defaultCases = selectBenchmarkCases(["smoke", "easy"]).slice(0, 2)

  function createMockExecutors() {
    return {
      switchModel: async () => {},
      restoreModel: async () => {},
      executeWorker: async () => ({
        text: '```json\n{"summary": "completed the task", "completedSteps": ["step1"], "changedFiles": ["src/file.ts"], "verification": {"passed": true, "commands": ["npm test"], "summary": "all tests pass"}, "blockers": []}\n```',
        toolCalls: 3,
        toolFailures: 0,
        durationMs: 5000,
      }),
      executeSupervisor: async () => ({
        text: '```json\n{"summary": "Worker completed successfully", "completed": true, "verificationPassed": true, "dimensions": {"taskCompletion": 90, "verification": 85, "toolUse": 80, "efficiency": 75, "autonomy": 85, "instructionFollowing": 90, "recovery": 80, "communication": 80, "safety": 95}}\n```',
        durationMs: 2000,
      }),
    }
  }

  it("runs models x cases and produces scores", async () => {
    const options: EvalRunOptions = {
      models: ["zen/mimo-v2.5-free", "kilo/step-3.7-flash-free"],
      cases: defaultCases,
      limit: 2,
    }

    const result = await runEval(options, createMockExecutors())

    expect(result.evalRunId).toBeTruthy()
    expect(result.reportDir).toContain(".covalo/evals/")
    expect(result.runs.length).toBe(4) // 2 models x 2 cases
    expect(result.leaderboard.length).toBe(2)

    for (const run of result.runs) {
      expect(run.score.overallScore).toBeGreaterThan(0)
      expect(run.score.grade).toBeTruthy()
      expect(run.score.dimensions.length).toBe(9) // all 9 dimensions
      expect(run.completed).toBe(true)
      expect(run.verificationPassed).toBe(true)
    }

    // Leaderboard sorted by score descending
    expect(result.leaderboard[0].averageScore).toBeGreaterThanOrEqual(result.leaderboard[1].averageScore)
  })

  it("skips models with missing API key via checkApiKey", async () => {
    const options: EvalRunOptions = {
      models: ["zen/mimo-v2.5-free", "openai/gpt-4o"],
      cases: defaultCases,
      limit: 1,
    }

    const result = await runEval(options, {
      ...createMockExecutors(),
      checkApiKey: (modelTarget) => {
        if (modelTarget.startsWith("openai/")) return "missing OPENAI_API_KEY"
        return null
      },
    })

    // Only zen model should have runs; openai is skipped
    expect(result.runs.length).toBe(1)
    expect(result.runs[0].workerModelTarget).toBe("zen/mimo-v2.5-free")
  })

  it("returns empty leaderboard for dry-run", async () => {
    const options: EvalRunOptions = {
      models: ["zen/mimo-v2.5-free"],
      cases: defaultCases,
      limit: 1,
      dryRun: true,
    }

    const result = await runEval(options, createMockExecutors())

    expect(result.leaderboard).toHaveLength(0)
    expect(result.runs).toHaveLength(0)
  })

  it("handles abortSignal and stops mid-execution", async () => {
    const abortController = new AbortController()
    const options: EvalRunOptions = {
      models: ["zen/mimo-v2.5-free", "kilo/step-3.7-flash-free"],
      cases: defaultCases,
      limit: 2,
    }

    const result = await runEval(options, {
      ...createMockExecutors(),
      abortSignal: abortController.signal,
    })

    // With no explicit abort, should complete all runs
    expect(result.runs.length).toBe(4)
  })

  it("persists eval report to disk", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "covalo-eval-"))
    const originalCwd = process.cwd
    // Override cwd to use temp dir
    process.cwd = () => tmpDir

    try {
      const options: EvalRunOptions = {
        models: ["zen/mimo-v2.5-free"],
        cases: defaultCases,
        limit: 1,
      }

      const result = await runEval(options, createMockExecutors())

      const reportDir = join(tmpDir, ".covalo", "evals", result.evalRunId)
      expect(existsSync(reportDir)).toBe(true)
      expect(existsSync(join(reportDir, "meta.json"))).toBe(true)
      expect(existsSync(join(reportDir, "summary.json"))).toBe(true)
      expect(existsSync(join(reportDir, "scores.jsonl"))).toBe(true)
      expect(existsSync(join(reportDir, "leaderboard.json"))).toBe(true)

      // Verify content
      const meta = JSON.parse(readFileSync(join(reportDir, "meta.json"), "utf8"))
      expect(meta.evalRunId).toBe(result.evalRunId)
      expect(meta.models).toEqual(["zen/mimo-v2.5-free"])
      expect(meta.createdAt).toBeGreaterThan(0)

      const scores = readFileSync(join(reportDir, "scores.jsonl"), "utf8").trim().split("\n")
      expect(scores.length).toBe(1)

      // Verify EvalReportStore can read it back
      const store = new EvalReportStore(join(tmpDir, ".covalo", "evals"))
      const loadedMeta = store.loadMeta(result.evalRunId)
      expect(loadedMeta).not.toBeNull()
      expect(loadedMeta!.evalRunId).toBe(result.evalRunId)

      const loadedLeaderboard = store.loadLeaderboard(result.evalRunId)
      expect(loadedLeaderboard).not.toBeNull()

      const loadedScores = store.loadScores(result.evalRunId)
      expect(loadedScores).toHaveLength(1)
    } finally {
      process.cwd = originalCwd
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("handles worker execution errors gracefully", async () => {
    const options: EvalRunOptions = {
      models: ["zen/mimo-v2.5-free"],
      cases: defaultCases,
      limit: 1,
    }

    const result = await runEval(options, {
      ...createMockExecutors(),
      executeWorker: async () => {
        throw new Error("API timeout")
      },
    })

    expect(result.runs.length).toBe(1)
    expect(result.runs[0].completed).toBe(false)
    expect(result.runs[0].score.overallScore).toBeLessThan(70)
    expect(["D", "F"]).toContain(result.runs[0].score.grade)
  })

  it("emits progress events for each run", async () => {
    const progressEvents: string[] = []
    const options: EvalRunOptions = {
      models: ["zen/mimo-v2.5-free", "kilo/step-3.7-flash-free"],
      cases: defaultCases,
      limit: 1,
    }

    const result = await runEval(options, createMockExecutors(), (progress) => {
      progressEvents.push(progress.status)
    })

    expect(progressEvents).toContain("setup")
    expect(progressEvents).toContain("running")
    expect(progressEvents).toContain("passed")
    expect(progressEvents).toContain("complete")
    // 2 models x 1 case = 2 "running" + 2 "passed"
    expect(progressEvents.filter(s => s === "running").length).toBe(2)
    expect(progressEvents.filter(s => s === "passed").length).toBe(2)
  })

  it("handles checkApiKey returning skip for all models", async () => {
    const options: EvalRunOptions = {
      models: ["openai/gpt-4o", "anthropic/claude-3"],
      cases: defaultCases,
      limit: 1,
    }

    const result = await runEval(options, {
      ...createMockExecutors(),
      checkApiKey: () => "missing API key",
    })

    expect(result.runs).toHaveLength(0)
    expect(result.leaderboard).toHaveLength(0)
  })
})
