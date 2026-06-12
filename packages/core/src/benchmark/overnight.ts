/**
 * DRF-80：Overnight 长跑稳定性检查
 *
 * 模拟 8 小时长跑，检测无限循环、进程泄漏与 checkpoint 损坏。
 */

import type { BenchmarkRunResult, OvernightStabilityResult } from "./types.js"

/** 循环历史条目 */
export interface LoopHistoryEntry {
  /** 迭代序号 */
  iteration: number
  /** 循环计数 */
  loopCount: number
  /** 状态签名（用于检测停滞） */
  stateSignature: string
}

/** 无限循环检测配置 */
export interface InfiniteLoopDetectionConfig {
  /** 最大允许循环次数 */
  maxLoopCount?: number
  /** 相同状态签名重复阈值 */
  maxRepeatedSignature?: number
}

const DEFAULT_LOOP_CONFIG: Required<InfiniteLoopDetectionConfig> = {
  maxLoopCount: 120,
  maxRepeatedSignature: 5,
}

/**
 * 检测运行历史中是否存在无限循环迹象。
 *
 * @param history - 循环历史
 * @param config - 检测配置
 */
export function detectInfiniteLoop(
  history: LoopHistoryEntry[],
  config: InfiniteLoopDetectionConfig = {},
): { detected: boolean; reason?: string } {
  const cfg = { ...DEFAULT_LOOP_CONFIG, ...config }
  const signatureCounts = new Map<string, number>()

  for (const entry of history) {
    if (entry.loopCount > cfg.maxLoopCount) {
      return {
        detected: true,
        reason: `迭代 ${entry.iteration} 循环次数 ${entry.loopCount} 超过上限 ${cfg.maxLoopCount}`,
      }
    }

    const count = (signatureCounts.get(entry.stateSignature) ?? 0) + 1
    signatureCounts.set(entry.stateSignature, count)
    if (count >= cfg.maxRepeatedSignature) {
      return {
        detected: true,
        reason: `状态签名 "${entry.stateSignature}" 重复 ${count} 次，疑似停滞循环`,
      }
    }
  }

  return { detected: false }
}

/**
 * 从单次 benchmark 结果生成循环历史条目。
 *
 * @param result - 运行结果
 * @param iteration - 迭代序号
 */
export function loopHistoryFromResult(
  result: BenchmarkRunResult,
  iteration: number,
): LoopHistoryEntry {
  return {
    iteration,
    loopCount: result.loopCount,
    // 含 iteration 避免跨轮采样误判为单会话内停滞
    stateSignature: `${result.cell.id}:${iteration}:${result.completed}:${result.loopCount}`,
  }
}

/** Overnight 模拟配置 */
export interface OvernightSimulationConfig {
  /** 模拟迭代轮数（代表 8h 长跑采样） */
  iterations?: number
  /** 注入故障的迭代序号（用于测试） */
  injectFaultAt?: number[]
}

const DEFAULT_OVERNIGHT_CONFIG: Required<Omit<OvernightSimulationConfig, "injectFaultAt">> = {
  iterations: 48,
}

/**
 * 模拟 overnight 长跑稳定性：对多轮 mock 结果检查无限循环与资源泄漏。
 *
 * @param runFactory - 每轮生成运行结果的工厂函数
 * @param config - 模拟配置
 */
export function simulateOvernightStability(
  runFactory: (iteration: number) => BenchmarkRunResult,
  config: OvernightSimulationConfig = {},
): OvernightStabilityResult {
  const iterations = config.iterations ?? DEFAULT_OVERNIGHT_CONFIG.iterations
  const injectFaultAt = new Set(config.injectFaultAt ?? [])

  const failures: string[] = []
  let infiniteLoopDetections = 0
  let processLeaks = 0
  let checkpointCorruptions = 0

  const history: LoopHistoryEntry[] = []

  for (let i = 0; i < iterations; i++) {
    const result = runFactory(i)
    if (injectFaultAt.has(i)) {
      result.loopCount = 200
    }

    const entry = loopHistoryFromResult(result, i)
    history.push(entry)

    // 仅检查当前轮次是否超限，不把跨轮相似结果当作单会话无限循环
    const loopCheck = detectInfiniteLoop([entry])
    if (loopCheck.detected) {
      infiniteLoopDetections++
      failures.push(loopCheck.reason!)
    }

    if (result.backgroundProcessLeaked) {
      processLeaks++
      failures.push(`迭代 ${i} 检测到后台进程泄漏`)
    }

    if (result.checkpointCorrupted) {
      checkpointCorruptions++
      failures.push(`迭代 ${i} checkpoint 损坏`)
    }
  }

  return {
    passed: failures.length === 0,
    iterations,
    infiniteLoopDetections,
    processLeaks,
    checkpointCorruptions,
    failures,
  }
}

/**
 * 断言 overnight 稳定性结果通过。
 *
 * @param result - 稳定性结果
 */
export function assertOvernightStability(result: OvernightStabilityResult): void {
  if (!result.passed) {
    throw new Error(
      `Overnight 稳定性未通过：${result.failures.slice(0, 3).join("; ")}` +
        (result.failures.length > 3 ? `（另有 ${result.failures.length - 3} 项）` : ""),
    )
  }
}
