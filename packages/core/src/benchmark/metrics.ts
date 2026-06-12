/**
 * DRF-80：Benchmark 指标收集器
 *
 * 从单次或批量运行结果聚合完成率、验证通过率、工具失败率等指标。
 */

import type { BenchmarkMetrics, BenchmarkRunResult } from "./types.js"

/**
 * 从单次运行结果提取指标快照（单样本）。
 *
 * @param result - 单次运行结果
 */
export function metricsFromSingleRun(result: BenchmarkRunResult): BenchmarkMetrics {
  return collectBenchmarkMetrics([result])
}

/**
 * 聚合多次 benchmark 运行结果为统一指标。
 *
 * @param results - 运行结果列表
 */
export function collectBenchmarkMetrics(results: BenchmarkRunResult[]): BenchmarkMetrics {
  if (results.length === 0) {
    return {
      completionRate: 0,
      verificationPassRate: 0,
      toolFailureRate: 0,
      avgLoopCount: 0,
      totalSupervisorCount: 0,
      avgSupervisorCount: 0,
      freePoolAvailabilityRate: 0,
      paidModelInvokeRate: 0,
      sampleCount: 0,
    }
  }

  const n = results.length
  const completed = results.filter((r) => r.completed).length
  const verified = results.filter((r) => r.verificationPassed).length
  const totalToolCalls = results.reduce((s, r) => s + r.toolCalls, 0)
  const totalToolFailures = results.reduce((s, r) => s + r.toolFailures, 0)
  const totalLoops = results.reduce((s, r) => s + r.loopCount, 0)
  const totalSupervisor = results.reduce((s, r) => s + r.supervisorCount, 0)
  const freePoolOk = results.filter((r) => r.freePoolAvailable).length
  const paidInvoked = results.filter((r) => r.paidModelInvoked).length

  return {
    completionRate: completed / n,
    verificationPassRate: verified / n,
    toolFailureRate: totalToolCalls > 0 ? totalToolFailures / totalToolCalls : 0,
    avgLoopCount: totalLoops / n,
    totalSupervisorCount: totalSupervisor,
    avgSupervisorCount: totalSupervisor / n,
    freePoolAvailabilityRate: freePoolOk / n,
    paidModelInvokeRate: paidInvoked / n,
    sampleCount: n,
  }
}

/**
 * 按 Harness 模式分组聚合指标。
 *
 * @param results - 运行结果列表
 */
export function collectMetricsByHarness(
  results: BenchmarkRunResult[],
): Map<string, BenchmarkMetrics> {
  const groups = new Map<string, BenchmarkRunResult[]>()
  for (const r of results) {
    const key = r.cell.harness
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }

  const out = new Map<string, BenchmarkMetrics>()
  for (const [harness, group] of groups) {
    out.set(harness, collectBenchmarkMetrics(group))
  }
  return out
}

/**
 * 格式化指标为人类可读摘要。
 *
 * @param metrics - 聚合指标
 */
export function formatBenchmarkMetrics(metrics: BenchmarkMetrics): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  return [
    `samples=${metrics.sampleCount}`,
    `completion=${pct(metrics.completionRate)}`,
    `verification=${pct(metrics.verificationPassRate)}`,
    `toolFailure=${pct(metrics.toolFailureRate)}`,
    `avgLoops=${metrics.avgLoopCount.toFixed(1)}`,
    `supervisor=${metrics.avgSupervisorCount.toFixed(1)}`,
    `freePool=${pct(metrics.freePoolAvailabilityRate)}`,
    `paidModel=${pct(metrics.paidModelInvokeRate)}`,
  ].join(" | ")
}
