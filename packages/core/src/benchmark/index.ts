/**
 * DRF-80：Fusion Benchmark 模块入口
 */

export {
  BENCHMARK_WORKER_PROFILES,
  BENCHMARK_HARNESS_MODES,
  BENCHMARK_TASK_TYPES,
  buildBenchmarkCellId,
  createBenchmarkCell,
  buildBenchmarkMatrix,
  buildReleaseGateMatrix,
  filterCellsByHarness,
  filterCellsByWorker,
} from "./matrix.js"

export {
  collectBenchmarkMetrics,
  collectMetricsByHarness,
  metricsFromSingleRun,
  formatBenchmarkMetrics,
} from "./metrics.js"

export {
  simulateBenchmarkRun,
  simulateBenchmarkMatrix,
} from "./simulator.js"
export type { SimulateRunOptions } from "./simulator.js"

export {
  assertSupervisorImprovesCompletion,
  assertSupervisorAdvisoryOnly,
  assertNoPaidModelByDefault,
  assertFreePoolDegradedPreservesState,
  evaluateReleaseGate,
} from "./release-gate.js"
export type { ReleaseGateConfig } from "./release-gate.js"

export {
  detectInfiniteLoop,
  loopHistoryFromResult,
  simulateOvernightStability,
  assertOvernightStability,
} from "./overnight.js"
export type {
  LoopHistoryEntry,
  InfiniteLoopDetectionConfig,
  OvernightSimulationConfig,
} from "./overnight.js"

export type {
  WorkerProfileId,
  BenchmarkHarnessId,
  BenchmarkTaskType,
  BenchmarkCell,
  BenchmarkRunResult,
  BenchmarkMetrics,
  ReleaseGateResult,
  ReleaseGateCheck,
  OvernightStabilityResult,
} from "./types.js"
