/**
 * DRF-80：发布门禁断言
 *
 * 验证 supervisor-guided 相比 baseline 提升完成率，且 Supervisor 仅提供指导。
 */

import { collectBenchmarkMetrics } from "./metrics.js"
import type {
  BenchmarkMetrics,
  BenchmarkRunResult,
  ReleaseGateCheck,
  ReleaseGateResult,
} from "./types.js"

/** 发布门禁配置 */
export interface ReleaseGateConfig {
  /** supervisor-guided 相对 baseline 的最小完成率提升 */
  minCompletionLift?: number
  /** 允许的最大付费模型调用率 */
  maxPaidModelRate?: number
  /** Supervisor 直接执行工具的最大允许次数（合计） */
  maxSupervisorToolExecutions?: number
}

const DEFAULT_RELEASE_GATE_CONFIG: Required<ReleaseGateConfig> = {
  minCompletionLift: 0.1,
  maxPaidModelRate: 0,
  maxSupervisorToolExecutions: 0,
}

/**
 * 断言 supervisor-guided 完成率高于 baseline。
 *
 * @param baseline - baseline 指标
 * @param guided - supervisor-guided 指标
 * @param minLift - 最小提升幅度
 */
export function assertSupervisorImprovesCompletion(
  baseline: BenchmarkMetrics,
  guided: BenchmarkMetrics,
  minLift = DEFAULT_RELEASE_GATE_CONFIG.minCompletionLift,
): ReleaseGateCheck {
  const lift = guided.completionRate - baseline.completionRate
  const passed = lift >= minLift && guided.completionRate > baseline.completionRate
  return {
    name: "supervisor_completion_lift",
    passed,
    message: passed
      ? `supervisor-guided 完成率 ${(guided.completionRate * 100).toFixed(1)}% 高于 baseline ${(baseline.completionRate * 100).toFixed(1)}%（提升 ${(lift * 100).toFixed(1)}%）`
      : `supervisor-guided 完成率 ${(guided.completionRate * 100).toFixed(1)}% 未显著高于 baseline ${(baseline.completionRate * 100).toFixed(1)}%（需提升 ≥${(minLift * 100).toFixed(1)}%）`,
  }
}

/**
 * 断言 Supervisor 仅提供指导、不替代 Worker 执行工具。
 *
 * @param results - supervisor-guided 运行结果
 */
export function assertSupervisorAdvisoryOnly(results: BenchmarkRunResult[]): ReleaseGateCheck {
  const totalSupervisorTools = results.reduce((s, r) => s + r.supervisorToolExecutions, 0)
  const totalWorkerTools = results.reduce((s, r) => s + r.workerToolExecutions, 0)
  const passed = totalSupervisorTools === 0 && totalWorkerTools > 0
  return {
    name: "supervisor_advisory_only",
    passed,
    message: passed
      ? `Supervisor 未直接执行工具（${totalSupervisorTools} 次），Worker 执行 ${totalWorkerTools} 次`
      : `Supervisor 不应直接执行工具，实际 ${totalSupervisorTools} 次`,
  }
}

/**
 * 断言默认配置不调用付费模型。
 *
 * @param results - 全部运行结果
 * @param maxRate - 允许的最大付费调用率
 */
export function assertNoPaidModelByDefault(
  results: BenchmarkRunResult[],
  maxRate = DEFAULT_RELEASE_GATE_CONFIG.maxPaidModelRate,
): ReleaseGateCheck {
  const metrics = collectBenchmarkMetrics(results)
  const passed = metrics.paidModelInvokeRate <= maxRate
  return {
    name: "no_paid_model_default",
    passed,
    message: passed
      ? `付费模型调用率 ${(metrics.paidModelInvokeRate * 100).toFixed(1)}% ≤ ${(maxRate * 100).toFixed(1)}%`
      : `付费模型调用率 ${(metrics.paidModelInvokeRate * 100).toFixed(1)}% 超过阈值 ${(maxRate * 100).toFixed(1)}%`,
  }
}

/**
 * 断言免费池不可用时仍保留任务状态（完成率 > 0 且无 checkpoint 损坏）。
 *
 * @param results - 免费池不可用场景的运行结果
 */
export function assertFreePoolDegradedPreservesState(
  results: BenchmarkRunResult[],
): ReleaseGateCheck {
  const corrupted = results.filter((r) => r.checkpointCorrupted).length
  const hasProgress = results.some((r) => r.completed || r.loopCount > 0)
  const passed = corrupted === 0 && hasProgress
  return {
    name: "free_pool_degraded_state",
    passed,
    message: passed
      ? "免费池不可用时无 checkpoint 损坏且任务状态可恢复"
      : `免费池降级失败：损坏 ${corrupted} 次，有进展 ${hasProgress}`,
  }
}

/**
 * 对 baseline 与 supervisor-guided 结果执行完整发布门禁评估。
 *
 * @param baselineResults - baseline 运行结果
 * @param guidedResults - supervisor-guided 运行结果
 * @param allResults - 全部结果（含付费模型检查）
 * @param config - 门禁配置
 */
export function evaluateReleaseGate(
  baselineResults: BenchmarkRunResult[],
  guidedResults: BenchmarkRunResult[],
  allResults: BenchmarkRunResult[],
  config: ReleaseGateConfig = {},
): ReleaseGateResult {
  const cfg = { ...DEFAULT_RELEASE_GATE_CONFIG, ...config }
  const baselineMetrics = collectBenchmarkMetrics(baselineResults)
  const guidedMetrics = collectBenchmarkMetrics(guidedResults)

  const checks: ReleaseGateCheck[] = [
    assertSupervisorImprovesCompletion(baselineMetrics, guidedMetrics, cfg.minCompletionLift),
    assertSupervisorAdvisoryOnly(guidedResults),
    assertNoPaidModelByDefault(allResults, cfg.maxPaidModelRate),
  ]

  return {
    passed: checks.every((c) => c.passed),
    checks,
  }
}
