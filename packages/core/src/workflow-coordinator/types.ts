import type { LoopEvent } from "../interface.js"
import type { AgentRole } from "../agent-profile/types.js"

export type WorkflowPhase =
  | "idle"
  | "supervisor_analyse"
  | "worker_do"
  | "worker_report"
  | "supervisor_check"
  | "supervisor_intervene"
  | "waiting_user"
  | "blocked"
  | "completed"
  | "failed"

export type WorkflowDecision =
  | "continue"
  | "revise"
  | "approve"
  | "blocked"
  | "ask_user"

export interface WorkflowConfig {
  maxRounds: number
  requireSupervisorPlan: boolean
  requireVerificationGate: boolean
}

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  maxRounds: 9,
  requireSupervisorPlan: true,
  requireVerificationGate: true,
}

export interface WorkflowLoopState {
  workflowId: string
  iteration: number
  maxRounds: number
  currentPhase: WorkflowPhase
  phaseHistory: WorkflowPhase[]
  ledgerVersion: number
  basedOnLedgerVersion?: number
  goal: string
  supervisorPlan?: string
  workerReport?: string
  /** 上一轮 Supervisor 检查反馈，供下一轮分析和 Worker 执行使用 */
  supervisorFeedback?: string
  /** 用户在中断后提供的恢复指令，仅供下一次 Supervisor 分析使用 */
  resumeInstruction?: string
  lastDecision?: WorkflowDecision
  /** Structured SupervisorDecision when parsed via zod */
  supervisorDecision?: Record<string, unknown>
  blockedReason?: string
  waitingUserRequestId?: string
  waitingUserQuestion?: string
  waitingUserRole?: AgentRole
  /** 中途 Supervisor 干预次数 */
  interventionCount: number
  /** 最近一次干预的原因 */
  lastInterventionReason?: string
  createdAt: number
  updatedAt: number
}

export interface SupervisorPlan {
  version: 1
  workflowId: string
  iteration: number
  goal: string
  summary: string
  steps: Array<{ id: string; description: string; verification?: string[] }>
  constraints: string[]
  risks: string[]
}

export interface WorkerCommand {
  workflowId: string
  iteration: number
  ledgerVersion: number
  goal: string
  plan: SupervisorPlan
  advice?: WorkflowSupervisorAdvice
}

export interface WorkerReport {
  version: 1
  workflowId: string
  iteration: number
  basedOnLedgerVersion: number
  summary: string
  completedSteps: string[]
  changedFiles: string[]
  verification: {
    passed: boolean
    commands: string[]
    summary: string
  }
  blockers: string[]
  requestsSupervisor: boolean
}

export interface SupervisorDecision {
  version: 1
  workflowId: string
  iteration: number
  basedOnLedgerVersion: number
  decision: WorkflowDecision
  diagnosis: string
  nextActions: string[]
  constraints: string[]
  verification: string[]
  revisedGoal?: string
  question?: string
}

export interface WorkflowEvidence {
  workflowId: string
  iteration: number
  ledgerVersion: number
  workerId: string
  tools: WorkflowEvidenceToolEntry[]
  failures: WorkflowEvidenceFailureEntry[]
  verification?: WorkflowEvidenceVerification
  summary: string
  timestamp: number
}

export interface WorkflowEvidenceToolEntry {
  name: string
  args: Record<string, unknown>
  result: string
  isError: boolean
  durationMs: number
}

export interface WorkflowEvidenceFailureEntry {
  phase: WorkflowPhase
  error: string
  timestamp: number
}

export interface WorkflowEvidenceVerification {
  passed: boolean
  commands: string[]
  output: string
  timestamp: number
}

export interface WorkflowSupervisorAdvice {
  workflowId: string
  iteration: number
  ledgerVersion: number
  decision: WorkflowDecision
  feedback?: string
  revisedGoal?: string
  approvedBy?: string
  timestamp: number
  stale: boolean
}

export interface WorkflowCheckpoint {
  workflowId: string
  state: WorkflowLoopState
  evidence?: WorkflowEvidence
  advice?: WorkflowSupervisorAdvice
  savedAt: number
}

export interface StartWorkflowOptions {
  goal: string
  config?: Partial<WorkflowConfig>
}

export interface WorkflowEvent {
  type: "phase_change" | "iteration_change" | "blocked" | "completed" | "failed" | "ask_user" | "supervisor_intervene" | "role_output" | "low_confidence_decision"
  workflowId: string
  phase?: WorkflowPhase
  iteration?: number
  reason?: string
  requestId?: string
  question?: string
  /** 中途干预时的 advice 摘要 */
  adviceSummary?: string
  /** low_confidence_decision 时的决策值 */
  decision?: WorkflowDecision
  timestamp: number
  /** SFR-60: role_output 事件携带原始 AgentRuntime 事件 */
  roleEvent?: LoopEvent
  agentRole?: AgentRole
  workflowMode?: string
}

export const SUPERVISOR_WORKFLOW_PROMPT = `You are the Supervisor in a managed workflow.
Analyze, plan, review evidence, and return the requested structured result.
The WorkflowCoordinator owns execution order: plan -> Worker execution -> Worker report -> Supervisor review.
You may use governance tools: get_goal, update_goal, list_dir, read_file, grep.
During analyse (planning), use list_dir to explore structure but do not read file content directly — delegate to Worker.
During check (review), you may read files to verify Worker output.
Do not use mailbox, dispatch, or engineering tools such as read_mailbox, send_message, followup_task, AgentTool, bash, edit, write, or apply_patch.
The coordinator passes your plan to Worker after this turn; do not try to send or execute the task yourself.
Do not perform Worker tasks yourself; delegate execution through the plan/review workflow.
Do not complete without a requirement-by-requirement completion audit with evidence.`
