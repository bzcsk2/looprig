import { describe, it, expect } from "vitest"

import {
  BENCHMARK_HARNESS_MODES,
  BENCHMARK_TASK_TYPES,
  BENCHMARK_WORKER_PROFILES,
  assertFreePoolDegradedPreservesState,
  assertNoPaidModelByDefault,
  assertOvernightStability,
  assertSupervisorAdvisoryOnly,
  assertSupervisorImprovesCompletion,
  buildBenchmarkMatrix,
  buildReleaseGateMatrix,
  collectBenchmarkMetrics,
  collectMetricsByHarness,
  detectInfiniteLoop,
  evaluateReleaseGate,
  filterCellsByHarness,
  formatBenchmarkMetrics,
  simulateBenchmarkMatrix,
  simulateBenchmarkRun,
  simulateOvernightStability,
} from "../src/benchmark/index.js"
import { createBenchmarkCell } from "../src/benchmark/matrix.js"

// ── DRF-80: Benchmark 矩阵定义 ─────────────────────────────

describe("DRF-80: Benchmark 矩阵", () => {
  it("覆盖 Worker × Harness × Task 固定矩阵", () => {
    const matrix = buildBenchmarkMatrix()
    const expectedSize =
      BENCHMARK_WORKER_PROFILES.length *
      BENCHMARK_HARNESS_MODES.length *
      BENCHMARK_TASK_TYPES.length

    expect(matrix).toHaveLength(expectedSize)
    expect(matrix[0].id).toMatch(/^.+\/.+\/.+$/)
    expect(new Set(matrix.map((c) => c.id)).size).toBe(expectedSize)
  })

  it("发布门禁子矩阵仅含 local-8b baseline 与 supervisor-guided", () => {
    const gate = buildReleaseGateMatrix()
    expect(gate).toHaveLength(BENCHMARK_TASK_TYPES.length * 2)
    expect(gate.every((c) => c.worker === "local-8b")).toBe(true)
    expect(new Set(gate.map((c) => c.harness))).toEqual(
      new Set(["baseline", "supervisor-guided"]),
    )
  })

  it("可按 Harness 筛选单元格", () => {
    const guided = filterCellsByHarness(buildBenchmarkMatrix(), "supervisor-guided")
    expect(guided.length).toBe(BENCHMARK_WORKER_PROFILES.length * BENCHMARK_TASK_TYPES.length)
    expect(guided.every((c) => c.harness === "supervisor-guided")).toBe(true)
  })
})

// ── DRF-80: 指标收集器 ─────────────────────────────────────

describe("DRF-80: 指标收集器", () => {
  it("聚合完成率、验证通过率、工具失败率、循环与 Supervisor 次数", () => {
    const cell = createBenchmarkCell("local-8b", "supervisor-guided", "single-file-fix")
    const results = [
      {
        ...simulateBenchmarkRun(cell, { seed: 1 }),
        completed: true,
        verificationPassed: true,
        toolCalls: 10,
        toolFailures: 2,
        loopCount: 8,
        supervisorCount: 2,
      },
      {
        ...simulateBenchmarkRun(cell, { seed: 2 }),
        completed: false,
        verificationPassed: false,
        toolCalls: 6,
        toolFailures: 1,
        loopCount: 12,
        supervisorCount: 1,
      },
    ]

    const metrics = collectBenchmarkMetrics(results)
    expect(metrics.sampleCount).toBe(2)
    expect(metrics.completionRate).toBe(0.5)
    expect(metrics.verificationPassRate).toBe(0.5)
    expect(metrics.toolFailureRate).toBeCloseTo(3 / 16, 5)
    expect(metrics.avgLoopCount).toBe(10)
    expect(metrics.totalSupervisorCount).toBe(3)
    expect(metrics.avgSupervisorCount).toBe(1.5)
  })

  it("按 Harness 分组聚合", () => {
    const runs = simulateBenchmarkMatrix(buildReleaseGateMatrix(), { seed: 99 })
    const byHarness = collectMetricsByHarness(runs)
    expect(byHarness.has("baseline")).toBe(true)
    expect(byHarness.has("supervisor-guided")).toBe(true)
    expect(byHarness.get("baseline")!.sampleCount).toBe(BENCHMARK_TASK_TYPES.length)
  })

  it("格式化指标摘要", () => {
    const metrics = collectBenchmarkMetrics(simulateBenchmarkMatrix(buildReleaseGateMatrix()))
    const text = formatBenchmarkMetrics(metrics)
    expect(text).toContain("completion=")
    expect(text).toContain("supervisor=")
  })
})

// ── DRF-80: 发布门禁 ───────────────────────────────────────

describe("DRF-80: 发布门禁", () => {
  it("supervisor-guided mock 完成率高于 baseline", () => {
    const gateMatrix = buildReleaseGateMatrix()
    const runs = simulateBenchmarkMatrix(gateMatrix, { seed: 2024 })
    const baselineRuns = runs.filter((r) => r.cell.harness === "baseline")
    const guidedRuns = runs.filter((r) => r.cell.harness === "supervisor-guided")

    const baselineMetrics = collectBenchmarkMetrics(baselineRuns)
    const guidedMetrics = collectBenchmarkMetrics(guidedRuns)

    const check = assertSupervisorImprovesCompletion(baselineMetrics, guidedMetrics)
    expect(check.passed).toBe(true)
    expect(guidedMetrics.completionRate).toBeGreaterThan(baselineMetrics.completionRate)
  })

  it("Supervisor 仅提供指导、不替代 Worker 执行", () => {
    const guidedRuns = simulateBenchmarkMatrix(
      filterCellsByHarness(buildBenchmarkMatrix(), "supervisor-guided"),
      { seed: 7 },
    )
    const check = assertSupervisorAdvisoryOnly(guidedRuns)
    expect(check.passed).toBe(true)
    expect(guidedRuns.every((r) => r.supervisorToolExecutions === 0)).toBe(true)
    expect(guidedRuns.some((r) => r.workerToolExecutions > 0)).toBe(true)
  })

  it("默认配置不调用付费模型", () => {
    const runs = simulateBenchmarkMatrix(buildBenchmarkMatrix(), { seed: 13 })
    const check = assertNoPaidModelByDefault(runs)
    expect(check.passed).toBe(true)
  })

  it("完整发布门禁评估通过", () => {
    const gateMatrix = buildReleaseGateMatrix()
    const gateRuns = simulateBenchmarkMatrix(gateMatrix, { seed: 42 })
    const allRuns = simulateBenchmarkMatrix(buildBenchmarkMatrix(), { seed: 42 })

    const baselineRuns = gateRuns.filter((r) => r.cell.harness === "baseline")
    const guidedRuns = gateRuns.filter((r) => r.cell.harness === "supervisor-guided")

    const gate = evaluateReleaseGate(baselineRuns, guidedRuns, allRuns)
    expect(gate.passed).toBe(true)
    expect(gate.checks.every((c) => c.passed)).toBe(true)
  })

  it("免费池不可用时保留任务状态", () => {
    const cell = createBenchmarkCell("local-8b", "supervisor-guided", "recovery")
    const degraded = [
      simulateBenchmarkRun(cell, { seed: 5, freePoolUnavailable: true }),
      simulateBenchmarkRun(cell, { seed: 6, freePoolUnavailable: true }),
    ]
    const check = assertFreePoolDegradedPreservesState(degraded)
    expect(check.passed).toBe(true)
  })
})

// ── DRF-80: Overnight 稳定性 ─────────────────────────────────

describe("DRF-80: Overnight 稳定性", () => {
  it("无限循环检测 helper 识别超阈值循环", () => {
    const detection = detectInfiniteLoop([
      { iteration: 0, loopCount: 10, stateSignature: "a" },
      { iteration: 1, loopCount: 15, stateSignature: "b" },
      { iteration: 2, loopCount: 150, stateSignature: "c" },
    ])
    expect(detection.detected).toBe(true)
    expect(detection.reason).toContain("超过上限")
  })

  it("无限循环检测 helper 识别重复状态签名", () => {
    const detection = detectInfiniteLoop([
      { iteration: 0, loopCount: 5, stateSignature: "stuck" },
      { iteration: 1, loopCount: 6, stateSignature: "stuck" },
      { iteration: 2, loopCount: 7, stateSignature: "stuck" },
      { iteration: 3, loopCount: 8, stateSignature: "stuck" },
      { iteration: 4, loopCount: 9, stateSignature: "stuck" },
    ])
    expect(detection.detected).toBe(true)
    expect(detection.reason).toContain("停滞循环")
  })

  it("模拟 8h 长跑无无限循环、无泄漏、无 checkpoint 损坏", () => {
    const cell = createBenchmarkCell("local-8b", "supervisor-guided", "recovery")
    const stability = simulateOvernightStability(
      (i) => simulateBenchmarkRun(cell, { seed: 1000 + i }),
      { iterations: 48 },
    )

    expect(stability.passed).toBe(true)
    expect(stability.infiniteLoopDetections).toBe(0)
    expect(stability.processLeaks).toBe(0)
    expect(stability.checkpointCorruptions).toBe(0)
    expect(() => assertOvernightStability(stability)).not.toThrow()
  })

  it("注入故障时 overnight 检查失败", () => {
    const cell = createBenchmarkCell("local-8b", "baseline", "long-command")
    const stability = simulateOvernightStability(
      (i) => simulateBenchmarkRun(cell, { seed: 2000 + i }),
      { iterations: 10, injectFaultAt: [5] },
    )
    expect(stability.passed).toBe(false)
    expect(stability.infiniteLoopDetections).toBeGreaterThan(0)
  })
})
