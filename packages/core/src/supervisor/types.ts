/**
 * SupervisorAdvice 协议与 EvidenceBundle 类型定义。
 *
 * DRF-50：从 SmallCode escalation/reviewer 与 iceCoder 触发信号思路适配（MIT）。
 * Source refs: smallcode/bin/escalation.js, smallcode/src/model/reviewer.js
 */

/** SupervisorAdvice 协议版本 */
export const SUPERVISOR_ADVICE_VERSION = 1 as const

/**
 * 失败分类 — 用于诊断与路由 Supervisor 提示。
 */
export type FailureClass =
  | "tool_format"
  | "wrong_strategy"
  | "missing_context"
  | "verification_failure"
  | "goal_drift"
  | "provider_failure"
  | "unknown"

/** Supervisor 结构化指导输出（首版仅建议，不可执行工具/patch） */
export interface SupervisorAdvice {
  version: typeof SUPERVISOR_ADVICE_VERSION
  diagnosis: string
  failureClass: FailureClass
  nextActions: string[]
  constraints: string[]
  verification: string[]
  confidence: number
  shouldContinue: boolean
  requiresUser?: boolean
}

/** 近期失败摘要条目 */
export interface EvidenceFailureEntry {
  signature: string
  summary: string
}

/** 近期工具调用摘要条目 */
export interface EvidenceToolEntry {
  name: string
  success: boolean
  summary: string
}

/** 验证失败摘要 */
export interface EvidenceVerification {
  command: string
  exitCode: number
  tail: string
}

/**
 * 发给远程 Supervisor 的有界证据包。
 * 不包含完整仓库、会话、密钥或无关文件正文。
 */
export interface EvidenceBundle {
  goal: string
  activeStep?: string
  failureClass: FailureClass
  recentFailures: EvidenceFailureEntry[]
  recentTools: EvidenceToolEntry[]
  changedFiles: string[]
  verification?: EvidenceVerification
  attemptedStrategies: string[]
}

/** Supervisor 触发原因 */
export type SupervisorTriggerReason =
  | "branch_budget_block"
  | "error_signature_threshold"
  | "verification_failure"
  | "salvage_failure"
  | "read_loop"
  | "patch_spiral"
  | "repetition_loop"
  | "greeting_regression"
  | "ask_supervisor"
  | "goal_drift"
  | "ledger_no_progress"

/** Worker 结构化 ask_supervisor 请求 */
export interface AskSupervisorRequest {
  reason?: string
  failureClass?: FailureClass
}

/** 同一失败签名的 Supervisor 请求历史条目 */
export interface FailureSignatureRecord {
  count: number
  lastEvidenceHash?: string
}

/** shouldRequestSupervisor 判定结果 */
export interface SupervisorTriggerDecision {
  shouldRequest: boolean
  reason?: SupervisorTriggerReason
  failureClass?: FailureClass
  message?: string
}

/** buildEvidenceBundle 输入 */
export interface BuildEvidenceBundleInput {
  ledger: {
    goal: string
    plan?: Array<{ text: string; status: string }>
    changedFiles: string[]
    lastVerification?: { command: string; exitCode: number; summary: string }
    blockers?: string[]
  }
  failureClass: FailureClass
  recentFailures?: EvidenceFailureEntry[]
  recentTools?: EvidenceToolEntry[]
  attemptedStrategies?: string[]
  verificationTail?: string
  stopSignalReason?: string
}

/** shouldRequestSupervisor 输入上下文 */
export interface SupervisorTriggerContext {
  /** BranchBudget 硬拦截判定 */
  branchBlock?: { blocked: boolean; message?: string }
  /** BranchBudget 恢复/超限判定 */
  branchRecover?: { triggered: boolean; reason?: string; dimension?: string }
  /** 近期失败历史（checkpoint 风格） */
  recentFailures?: Array<{ signature: string; count: number; lastError?: string }>
  /** EarlyStop 信号 */
  stopSignal?: { reason: string; message: string }
  /** 连续验证失败次数 */
  consecutiveVerificationFailures?: number
  /** tool-call / 参数 salvage 连续失败次数 */
  consecutiveSalvageFailures?: number
  /** Worker 结构化 ask_supervisor */
  askSupervisor?: AskSupervisorRequest
  /** 检测到目标漂移 */
  goalDriftDetected?: boolean
  /** TaskLedger 无净进展轮次 */
  ledgerStagnantRounds?: number
  /** 最近一次普通工具失败（非复合信号） */
  singleToolFailureOnly?: boolean
  /** Provider 429/限流 — 应先 failover */
  providerRateLimited?: boolean
  /** 用户刚明确要求继续当前策略 */
  userContinuedSameStrategy?: boolean
  /** 当前 evidence hash */
  currentEvidenceHash?: string
  /** 当前失败签名 */
  currentFailureSignature?: string
  /** 同签名 Supervisor 请求历史 */
  failureSignatureHistory?: Record<string, FailureSignatureRecord>
  /** Supervisor 是否已配置可用 */
  supervisorConfigured?: boolean
}

/** Supervisor 触发器配置 */
export interface SupervisorTriggerConfig {
  /** 同错误签名触发阈值（对齐 BranchBudget errorRepeatMax） */
  errorSignatureThreshold: number
  /** 连续验证失败触发阈值 */
  consecutiveVerificationFailures: number
  /** salvage 连续失败触发阈值 */
  consecutiveSalvageFailures: number
  /** TaskLedger 无进展轮次阈值 */
  ledgerStagnantRoundThreshold: number
  /** 同 failure signature 最多请求 Supervisor 次数 */
  maxRequestsPerSignature: number
  /** 至少多少次同签名失败才开始触发（借鉴 adaptive_router min calls） */
  minErrorSamples: number
}

/** 默认触发器配置 */
export const DEFAULT_SUPERVISOR_TRIGGER_CONFIG: SupervisorTriggerConfig = {
  errorSignatureThreshold: 3,
  consecutiveVerificationFailures: 2,
  consecutiveSalvageFailures: 3,
  ledgerStagnantRoundThreshold: 5,
  maxRequestsPerSignature: 2,
  minErrorSamples: 3,
}
