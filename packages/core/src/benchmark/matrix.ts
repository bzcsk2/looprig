/**
 * DRF-80：Benchmark 矩阵定义
 *
 * 固定 Worker 画像 × Harness 模式 × 任务类型的覆盖矩阵。
 */

import type {
  BenchmarkCell,
  BenchmarkHarnessId,
  BenchmarkTaskType,
  WorkerProfileId,
} from "./types.js"

/** 最少覆盖的 Worker 画像 */
export const BENCHMARK_WORKER_PROFILES: readonly WorkerProfileId[] = [
  "local-8b",
  "local-14b-20b",
  "remote-medium",
] as const

/** 最少覆盖的 Harness 模式 */
export const BENCHMARK_HARNESS_MODES: readonly BenchmarkHarnessId[] = [
  "baseline",
  "local-small-strict",
  "supervisor-guided",
] as const

/** 最少覆盖的任务类型 */
export const BENCHMARK_TASK_TYPES: readonly BenchmarkTaskType[] = [
  "single-file-fix",
  "multi-file-refactor",
  "failing-test-diagnosis",
  "long-command",
  "malformed-tool-call",
  "recovery",
] as const

/**
 * 构建单元格 ID。
 *
 * @param worker - Worker 画像
 * @param harness - Harness 模式
 * @param task - 任务类型
 */
export function buildBenchmarkCellId(
  worker: WorkerProfileId,
  harness: BenchmarkHarnessId,
  task: BenchmarkTaskType,
): string {
  return `${worker}/${harness}/${task}`
}

/**
 * 创建单个矩阵单元格。
 *
 * @param worker - Worker 画像
 * @param harness - Harness 模式
 * @param task - 任务类型
 */
export function createBenchmarkCell(
  worker: WorkerProfileId,
  harness: BenchmarkHarnessId,
  task: BenchmarkTaskType,
): BenchmarkCell {
  return {
    worker,
    harness,
    task,
    id: buildBenchmarkCellId(worker, harness, task),
  }
}

/**
 * 生成完整 benchmark 矩阵（Worker × Harness × Task）。
 */
export function buildBenchmarkMatrix(): BenchmarkCell[] {
  const cells: BenchmarkCell[] = []
  for (const worker of BENCHMARK_WORKER_PROFILES) {
    for (const harness of BENCHMARK_HARNESS_MODES) {
      for (const task of BENCHMARK_TASK_TYPES) {
        cells.push(createBenchmarkCell(worker, harness, task))
      }
    }
  }
  return cells
}

/**
 * 发布门禁对比用的核心子矩阵：local-8b × baseline/supervisor-guided × 全部任务。
 */
export function buildReleaseGateMatrix(): BenchmarkCell[] {
  const cells: BenchmarkCell[] = []
  for (const harness of ["baseline", "supervisor-guided"] as const) {
    for (const task of BENCHMARK_TASK_TYPES) {
      cells.push(createBenchmarkCell("local-8b", harness, task))
    }
  }
  return cells
}

/**
 * 按 Harness 模式筛选矩阵单元格。
 *
 * @param cells - 矩阵单元格列表
 * @param harness - 目标 Harness
 */
export function filterCellsByHarness(
  cells: BenchmarkCell[],
  harness: BenchmarkHarnessId,
): BenchmarkCell[] {
  return cells.filter((c) => c.harness === harness)
}

/**
 * 按 Worker 画像筛选矩阵单元格。
 *
 * @param cells - 矩阵单元格列表
 * @param worker - 目标 Worker
 */
export function filterCellsByWorker(
  cells: BenchmarkCell[],
  worker: WorkerProfileId,
): BenchmarkCell[] {
  return cells.filter((c) => c.worker === worker)
}
