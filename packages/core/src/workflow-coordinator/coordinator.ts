import { randomUUID } from "node:crypto"
import type {
  WorkflowPhase,
  WorkflowDecision,
  WorkflowConfig,
  WorkflowLoopState,
  WorkflowEvidence,
  WorkflowSupervisorAdvice,
  WorkflowCheckpoint,
  WorkflowEvent,
} from "./types.js"
import { DEFAULT_WORKFLOW_CONFIG } from "./types.js"

export interface StartWorkflowOptions {
  goal: string
  workflowId?: string
  maxRounds?: number
  config?: Partial<WorkflowConfig>
}

export interface WorkflowCoordinatorOptions {
  config?: Partial<WorkflowConfig>
  onEvent?: (event: WorkflowEvent) => void
}

export class WorkflowCoordinator {
  private state: WorkflowLoopState | null = null
  private config: WorkflowConfig
  private onEvent?: (event: WorkflowEvent) => void

  constructor(options: WorkflowCoordinatorOptions = {}) {
    this.config = { ...DEFAULT_WORKFLOW_CONFIG, ...options.config }
    this.onEvent = options.onEvent
  }

  getState(): WorkflowLoopState | null {
    return this.state ? { ...this.state } : null
  }

  getConfig(): WorkflowConfig {
    return { ...this.config }
  }

  startWorkflow(options: StartWorkflowOptions): WorkflowLoopState {
    if (this.state && this.state.currentPhase !== "completed" && this.state.currentPhase !== "failed") {
      throw new Error("Workflow already in progress")
    }

    const maxRounds = options.maxRounds ?? this.config.maxRounds

    this.state = {
      workflowId: options.workflowId ?? randomUUID(),
      iteration: 0,
      maxRounds,
      currentPhase: "idle",
      phaseHistory: [],
      ledgerVersion: 0,
      goal: options.goal,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.emitEvent({
      type: "phase_change",
      workflowId: this.state.workflowId,
      phase: "idle",
      iteration: 0,
      timestamp: Date.now(),
    })

    return this.getState()!
  }

  transition(to: WorkflowPhase, reason?: string): { success: boolean; error?: string } {
    if (!this.state) {
      return { success: false, error: "No workflow in progress" }
    }

    const from = this.state.currentPhase

    // Validate transition
    if (!this.isValidTransition(from, to)) {
      return { success: false, error: `Invalid transition from ${from} to ${to}` }
    }

    this.state.phaseHistory.push(from)
    this.state.currentPhase = to
    this.state.updatedAt = Date.now()

    if (to === "supervisor_analyse") {
      this.state.iteration++
      this.emitEvent({
        type: "iteration_change",
        workflowId: this.state.workflowId,
        iteration: this.state.iteration,
        timestamp: Date.now(),
      })
    }

    this.emitEvent({
      type: "phase_change",
      workflowId: this.state.workflowId,
      phase: to,
      iteration: this.state.iteration,
      reason,
      timestamp: Date.now(),
    })

    if (to === "blocked") {
      this.state.blockedReason = reason
      this.emitEvent({
        type: "blocked",
        workflowId: this.state.workflowId,
        reason,
        timestamp: Date.now(),
      })
    }

    if (to === "completed") {
      this.emitEvent({
        type: "completed",
        workflowId: this.state.workflowId,
        timestamp: Date.now(),
      })
    }

    if (to === "failed") {
      this.emitEvent({
        type: "failed",
        workflowId: this.state.workflowId,
        reason,
        timestamp: Date.now(),
      })
    }

    return { success: true }
  }

  setSupervisorPlan(plan: string): void {
    if (!this.state) {
      throw new Error("No workflow in progress")
    }
    this.state.supervisorPlan = plan
    this.state.updatedAt = Date.now()
  }

  setWorkerReport(report: string): void {
    if (!this.state) {
      throw new Error("No workflow in progress")
    }
    this.state.workerReport = report
    this.state.updatedAt = Date.now()
  }

  applyAdvice(advice: WorkflowSupervisorAdvice): boolean {
    if (!this.state) {
      throw new Error("No workflow in progress")
    }

    if (advice.workflowId !== this.state.workflowId) {
      return false
    }

    if (advice.iteration !== this.state.iteration) {
      return false
    }

    if (advice.stale) {
      return false
    }

    if (advice.ledgerVersion !== this.state.ledgerVersion) {
      advice.stale = true
      return false
    }

    this.state.lastDecision = advice.decision
    this.state.basedOnLedgerVersion = advice.ledgerVersion
    this.state.updatedAt = Date.now()

    if (advice.decision === "revise" && advice.revisedGoal) {
      this.state.goal = advice.revisedGoal
    }

    return true
  }

  canContinue(): boolean {
    if (!this.state) {
      return false
    }

    // Cannot continue if finished or blocked
    if (this.state.currentPhase === "completed" || this.state.currentPhase === "failed") {
      return false
    }

    // Check round limit
    return this.state.iteration < this.state.maxRounds
  }

  isFinished(): boolean {
    if (!this.state) {
      return false
    }
    return this.state.currentPhase === "completed" || this.state.currentPhase === "failed"
  }

  private isValidTransition(from: WorkflowPhase, to: WorkflowPhase): boolean {
    // Define valid transitions
    const validTransitions: Record<WorkflowPhase, WorkflowPhase[]> = {
      idle: ["supervisor_analyse", "blocked", "completed", "failed"],
      supervisor_analyse: ["worker_do", "blocked", "completed", "failed"],
      worker_do: ["worker_report", "blocked", "completed", "failed"],
      worker_report: ["supervisor_check", "blocked", "completed", "failed"],
      supervisor_check: ["supervisor_analyse", "blocked", "completed", "failed"],
      blocked: ["supervisor_analyse", "completed", "failed"],
      completed: [],
      failed: [],
    }

    return validTransitions[from]?.includes(to) ?? false
  }

  saveCheckpoint(): WorkflowCheckpoint {
    if (!this.state) {
      throw new Error("No workflow in progress")
    }

    return {
      workflowId: this.state.workflowId,
      state: { ...this.state },
      savedAt: Date.now(),
    }
  }

  restoreCheckpoint(checkpoint: WorkflowCheckpoint): void {
    this.state = { ...checkpoint.state }
    this.state.updatedAt = Date.now()
  }

  reset(): void {
    this.state = null
  }

  private emitEvent(event: WorkflowEvent): void {
    if (this.onEvent) {
      this.onEvent(event)
    }
  }
}
