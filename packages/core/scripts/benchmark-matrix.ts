#!/usr/bin/env bun
/**
 * DRF-80：Fusion Benchmark 矩阵入口
 *
 * 运行固定 Worker × Harness × Task 矩阵，输出指标与发布门禁结果。
 *
 * 用法：
 *   bun run packages/core/scripts/benchmark-matrix.ts
 *   bun run packages/core/scripts/benchmark-matrix.ts --release-gate-only
 *   bun run packages/core/scripts/benchmark-matrix.ts --overnight
 */

import {
  assertOvernightStability,
  buildBenchmarkMatrix,
  buildReleaseGateMatrix,
  collectBenchmarkMetrics,
  collectMetricsByHarness,
  evaluateReleaseGate,
  filterCellsByHarness,
  formatBenchmarkMetrics,
  simulateBenchmarkMatrix,
  simulateBenchmarkRun,
  simulateOvernightStability,
} from "../src/benchmark/index.js"
import { createBenchmarkCell } from "../src/benchmark/matrix.js"

const args = new Set(process.argv.slice(2))
const releaseGateOnly = args.has("--release-gate-only")
const overnightOnly = args.has("--overnight")

/**
 * 打印分段标题。
 *
 * @param title - 标题文本
 */
function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

/**
 * 运行完整矩阵 benchmark 并打印摘要。
 */
function runFullMatrix(): void {
  section("Fusion Benchmark 矩阵")
  const matrix = buildBenchmarkMatrix()
  console.log(`cells=${matrix.length}`)

  const runs = simulateBenchmarkMatrix(matrix, { seed: Date.now() % 10_000 })
  const overall = collectBenchmarkMetrics(runs)
  console.log(formatBenchmarkMetrics(overall))

  const byHarness = collectMetricsByHarness(runs)
  for (const [harness, metrics] of byHarness) {
    console.log(`  [${harness}] ${formatBenchmarkMetrics(metrics)}`)
  }
}

/**
 * 运行发布门禁评估。
 *
 * @returns 是否通过
 */
function runReleaseGate(): boolean {
  section("发布门禁")
  const gateMatrix = buildReleaseGateMatrix()
  const gateRuns = simulateBenchmarkMatrix(gateMatrix, { seed: 42 })
  const allRuns = releaseGateOnly
    ? gateRuns
    : simulateBenchmarkMatrix(buildBenchmarkMatrix(), { seed: 42 })

  const baselineRuns = gateRuns.filter((r) => r.cell.harness === "baseline")
  const guidedRuns = gateRuns.filter((r) => r.cell.harness === "supervisor-guided")

  const gate = evaluateReleaseGate(baselineRuns, guidedRuns, allRuns)
  for (const check of gate.checks) {
    const mark = check.passed ? "PASS" : "FAIL"
    console.log(`  [${mark}] ${check.name}: ${check.message}`)
  }
  console.log(`\n发布门禁: ${gate.passed ? "通过" : "未通过"}`)
  return gate.passed
}

/**
 * 运行 overnight 稳定性模拟。
 *
 * @returns 是否通过
 */
function runOvernight(): boolean {
  section("Overnight 稳定性（48 轮采样）")
  const cell = createBenchmarkCell("local-8b", "supervisor-guided", "recovery")
  const stability = simulateOvernightStability(
    (i) => simulateBenchmarkRun(cell, { seed: 3000 + i }),
    { iterations: 48 },
  )

  console.log(`  iterations=${stability.iterations}`)
  console.log(`  infiniteLoops=${stability.infiniteLoopDetections}`)
  console.log(`  processLeaks=${stability.processLeaks}`)
  console.log(`  checkpointCorruptions=${stability.checkpointCorruptions}`)
  console.log(`\nOvernight: ${stability.passed ? "通过" : "未通过"}`)

  if (!stability.passed) {
    for (const f of stability.failures.slice(0, 5)) {
      console.log(`  - ${f}`)
    }
  }

  return stability.passed
}

/**
 * 主入口。
 */
function main(): void {
  console.log("Deepreef Fusion Benchmark (DRF-80)")

  let ok = true

  if (!overnightOnly) {
    if (!releaseGateOnly) {
      runFullMatrix()
    }
    ok = runReleaseGate() && ok
  }

  if (!releaseGateOnly) {
    const overnightOk = runOvernight()
    if (overnightOk) {
      assertOvernightStability(
        simulateOvernightStability(
          (i) =>
            simulateBenchmarkRun(
              filterCellsByHarness(buildBenchmarkMatrix(), "supervisor-guided")[0] ??
                createBenchmarkCell("local-8b", "supervisor-guided", "recovery"),
              { seed: 4000 + i },
            ),
          { iterations: 48 },
        ),
      )
    }
    ok = overnightOk && ok
  }

  process.exit(ok ? 0 : 1)
}

main()
