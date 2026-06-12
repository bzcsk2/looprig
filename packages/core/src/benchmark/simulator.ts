/**
 * DRF-80：Benchmark 模拟运行器
 *
 * 在无真实 LLM 时生成确定性 mock 结果，用于单元测试与矩阵冒烟。
 */

import type {
  BenchmarkCell,
  BenchmarkHarnessId,
  BenchmarkRunResult,
  BenchmarkTaskType,
  WorkerProfileId,
} from "./types.js"

/** 模拟运行选项 */
export interface SimulateRunOptions {
  /** 随机种子，保证可复现 */
  seed?: number
  /** 是否模拟免费池不可用场景 */
  freePoolUnavailable?: boolean
}

/**
 * 简单可复现伪随机（LCG）。
 *
 * @param seed - 当前种子
 */
function nextSeed(seed: number): number {
  return (seed * 1_664_525 + 1_013_904_223) >>> 0
}

/**
 * 将 seed 映射到 [0, 1)。
 *
 * @param seed - 当前种子
 */
function seedToUnit(seed: number): number {
  return (seed >>> 0) / 0x1_0000_0000
}

/**
 * 根据 Harness 获取基础完成率。
 *
 * @param harness - Harness 模式
 */
function baseCompletionRate(harness: BenchmarkHarnessId): number {
  switch (harness) {
    case "baseline":
      return 0.58
    case "local-small-strict":
      return 0.72
    case "supervisor-guided":
      return 0.86
  }
}

/**
 * Worker 画像对难度的修正系数。
 *
 * @param worker - Worker 画像
 */
function workerDifficultyFactor(worker: WorkerProfileId): number {
  switch (worker) {
    case "local-8b":
      return 0.92
    case "local-14b-20b":
      return 1.0
    case "remote-medium":
      return 1.05
  }
}

/**
 * 任务类型难度系数。
 *
 * @param task - 任务类型
 */
function taskDifficultyFactor(task: BenchmarkTaskType): number {
  switch (task) {
    case "single-file-fix":
      return 1.05
    case "multi-file-refactor":
      return 0.88
    case "failing-test-diagnosis":
      return 0.9
    case "long-command":
      return 0.85
    case "malformed-tool-call":
      return 0.82
    case "recovery":
      return 0.93
  }
}

/**
 * 模拟单次 benchmark 运行，返回确定性 mock 指标。
 *
 * @param cell - 矩阵单元格
 * @param options - 模拟选项
 */
export function simulateBenchmarkRun(
  cell: BenchmarkCell,
  options: SimulateRunOptions = {},
): BenchmarkRunResult {
  let seed = options.seed ?? hashCellId(cell.id)

  // 完成判定仅依赖 worker+task，Harness 只调整阈值，保证同任务下 guided > baseline
  const rollSeed = hashCellId(`${cell.worker}/${cell.task}`)
  const roll = seedToUnit(nextSeed(rollSeed))

  const completionThreshold =
    baseCompletionRate(cell.harness) *
    workerDifficultyFactor(cell.worker) *
    taskDifficultyFactor(cell.task)

  const completed = roll < completionThreshold
  seed = nextSeed(seed)
  seed = nextSeed(seed)
  const verifyRoll = seedToUnit(seed)
  const verificationPassed = completed && verifyRoll < completionThreshold * 0.95

  seed = nextSeed(seed)
  const loopBase = cell.harness === "supervisor-guided" ? 8 : cell.harness === "baseline" ? 18 : 12
  const loopCount = Math.floor(loopBase + seedToUnit(seed) * 6)

  seed = nextSeed(seed)
  const toolCalls = Math.floor(4 + seedToUnit(seed) * 12)
  const toolFailureRate = cell.harness === "baseline" ? 0.22 : cell.harness === "supervisor-guided" ? 0.08 : 0.14
  seed = nextSeed(seed)
  const toolFailures = Math.floor(toolCalls * toolFailureRate * (0.5 + seedToUnit(seed)))

  const supervisorCount =
    cell.harness === "supervisor-guided"
      ? Math.max(1, Math.floor(loopCount / 4))
      : cell.harness === "local-small-strict"
        ? Math.floor(loopCount / 8)
        : 0

  const workerToolExecutions = toolCalls
  const supervisorToolExecutions = 0

  seed = nextSeed(seed)
  const durationMs = Math.floor(2_000 + seedToUnit(seed) * 8_000)

  const freePoolAvailable = options.freePoolUnavailable !== true
  const paidModelInvoked = false

  return {
    cell,
    completed,
    verificationPassed,
    toolCalls,
    toolFailures,
    loopCount,
    supervisorCount,
    workerToolExecutions,
    supervisorToolExecutions,
    durationMs,
    freePoolAvailable,
    paidModelInvoked,
    checkpointCorrupted: false,
    backgroundProcessLeaked: false,
  }
}

/**
 * 批量模拟矩阵运行。
 *
 * @param cells - 矩阵单元格列表
 * @param options - 模拟选项
 */
export function simulateBenchmarkMatrix(
  cells: BenchmarkCell[],
  options: SimulateRunOptions = {},
): BenchmarkRunResult[] {
  return cells.map((cell, i) =>
    simulateBenchmarkRun(cell, { ...options, seed: (options.seed ?? 42) + i }),
  )
}

/**
 * 将单元格 ID 哈希为数字种子。
 *
 * @param id - 单元格 ID
 */
function hashCellId(id: string): number {
  let h = 2_166_136_261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16_777_619)
  }
  return h >>> 0
}
