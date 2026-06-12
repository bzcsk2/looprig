/**
 * DRF-80：Fusion Benchmark 类型定义
 *
 * 定义 Worker 画像、Harness 模式、任务类型与运行结果结构。
 */

/** Worker 画像标识 */
export type WorkerProfileId = "local-8b" | "local-14b-20b" | "remote-medium"

/** Benchmark Harness 模式 */
export type BenchmarkHarnessId = "baseline" | "local-small-strict" | "supervisor-guided"

/** Benchmark 任务类型 */
export type BenchmarkTaskType =
  | "single-file-fix"
  | "multi-file-refactor"
  | "failing-test-diagnosis"
  | "long-command"
  | "malformed-tool-call"
  | "recovery"

/**
 * 矩阵单元格：Worker × Harness × Task 的唯一组合。
 */
export interface BenchmarkCell {
  /** Worker 画像 */
  worker: WorkerProfileId
  /** Harness 模式 */
  harness: BenchmarkHarnessId
  /** 任务类型 */
  task: BenchmarkTaskType
  /** 可读单元格 ID，格式 worker/harness/task */
  id: string
}

/**
 * 单次 benchmark 运行的原始结果。
 */
export interface BenchmarkRunResult {
  /** 对应矩阵单元格 */
  cell: BenchmarkCell
  /** 任务是否完成 */
  completed: boolean
  /** 验证是否通过 */
  verificationPassed: boolean
  /** 工具调用总次数 */
  toolCalls: number
  /** 工具失败次数 */
  toolFailures: number
  /** 主循环迭代次数 */
  loopCount: number
  /** Supervisor 请求次数 */
  supervisorCount: number
  /** Worker 执行的工具次数 */
  workerToolExecutions: number
  /** Supervisor 直接执行的工具次数（应为 0） */
  supervisorToolExecutions: number
  /** 运行耗时 ms */
  durationMs: number
  /** 免费池是否可用 */
  freePoolAvailable: boolean
  /** 是否调用了付费模型 */
  paidModelInvoked: boolean
  /** checkpoint 是否损坏 */
  checkpointCorrupted: boolean
  /** 是否有后台进程泄漏 */
  backgroundProcessLeaked: boolean
}

/**
 * 聚合后的 benchmark 指标。
 */
export interface BenchmarkMetrics {
  /** 完成率 [0, 1] */
  completionRate: number
  /** 验证通过率 [0, 1] */
  verificationPassRate: number
  /** 工具失败率 [0, 1] */
  toolFailureRate: number
  /** 平均循环次数 */
  avgLoopCount: number
  /** Supervisor 总次数 */
  totalSupervisorCount: number
  /** 平均 Supervisor 次数 */
  avgSupervisorCount: number
  /** 免费池可用率 [0, 1] */
  freePoolAvailabilityRate: number
  /** 付费模型调用率 [0, 1] */
  paidModelInvokeRate: number
  /** 样本数量 */
  sampleCount: number
}

/**
 * 发布门禁评估结果。
 */
export interface ReleaseGateResult {
  /** 是否通过全部门禁 */
  passed: boolean
  /** 各项检查明细 */
  checks: ReleaseGateCheck[]
}

/**
 * 单项发布门禁检查。
 */
export interface ReleaseGateCheck {
  /** 检查名称 */
  name: string
  /** 是否通过 */
  passed: boolean
  /** 说明信息 */
  message: string
}

/**
 * 长跑稳定性检查结果。
 */
export interface OvernightStabilityResult {
  /** 是否通过稳定性检查 */
  passed: boolean
  /** 模拟运行轮数 */
  iterations: number
  /** 检测到的无限循环次数 */
  infiniteLoopDetections: number
  /** 进程泄漏次数 */
  processLeaks: number
  /** checkpoint 损坏次数 */
  checkpointCorruptions: number
  /** 失败原因列表 */
  failures: string[]
}
