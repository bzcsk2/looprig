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
import type { DualAgentRuntime } from "../dual-agent-runtime/dual-runtime.js"
import type { QuestionService } from "../question/service.js"
import type { LoopEvent } from "../interface.js"

export interface StartWorkflowOptions {
  goal: string
  workflowId?: string
  maxRounds?: number
  config?: Partial<WorkflowConfig>
}

export interface WorkflowCoordinatorOptions {
  config?: Partial<WorkflowConfig>
  onEvent?: (event: WorkflowEvent) => void
  runtime?: DualAgentRuntime
  questionService?: QuestionService
}

export class WorkflowCoordinator {
  private state: WorkflowLoopState | null = null
  private config: WorkflowConfig
  private onEvent?: (event: WorkflowEvent) => void
  private runtime?: DualAgentRuntime
  private questionService?: QuestionService
  private abortController?: AbortController
  private pendingEvents: WorkflowEvent[] = []

  constructor(options: WorkflowCoordinatorOptions = {}) {
    this.config = { ...DEFAULT_WORKFLOW_CONFIG, ...options.config }
    this.onEvent = options.onEvent
    this.runtime = options.runtime
    this.questionService = options.questionService
  }

  getState(): WorkflowLoopState | null {
    return this.state ? { ...this.state } : null
  }

  getConfig(): WorkflowConfig {
    return { ...this.config }
  }

  setRuntime(runtime: DualAgentRuntime): void {
    this.runtime = runtime
  }

  setQuestionService(questionService: QuestionService): void {
    this.questionService = questionService
  }

  startWorkflow(options: StartWorkflowOptions): WorkflowLoopState {
    if (this.state && this.state.currentPhase !== "completed" && this.state.currentPhase !== "failed") {
      throw new Error("Workflow already in progress")
    }

    const maxRounds = options.maxRounds ?? this.config.maxRounds
    this.pendingEvents = []

    this.state = {
      workflowId: options.workflowId ?? randomUUID(),
      iteration: 0,
      maxRounds,
      currentPhase: "idle",
      phaseHistory: [],
      ledgerVersion: 0,
      goal: options.goal,
      interventionCount: 0,
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
      this.state.blockedReason = reason
      this.emitEvent({
        type: "failed",
        workflowId: this.state.workflowId,
        reason,
        timestamp: Date.now(),
      })
    }

    if (to === "supervisor_intervene") {
      this.state.interventionCount++
      this.emitEvent({
        type: "supervisor_intervene",
        workflowId: this.state.workflowId,
        phase: "supervisor_intervene",
        iteration: this.state.iteration,
        reason,
        adviceSummary: this.state.lastInterventionReason,
        timestamp: Date.now(),
      })
    }

    return { success: true }
  }

  getCurrentPhase(): WorkflowPhase {
    return this.state?.currentPhase ?? "idle"
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

    if (this.state.currentPhase === "completed" || this.state.currentPhase === "failed") {
      return false
    }

    if (this.state.currentPhase === "waiting_user") {
      return false
    }

    return this.state.iteration < this.state.maxRounds
  }

  isFinished(): boolean {
    if (!this.state) {
      return false
    }
    return this.state.currentPhase === "completed" || this.state.currentPhase === "failed"
  }

  async *runWorkflow(): AsyncGenerator<WorkflowEvent> {
    if (!this.state) {
      throw new Error("No workflow in progress")
    }

    if (!this.runtime) {
      throw new Error("No runtime configured")
    }

    this.abortController = new AbortController()

    // Start: idle → supervisor_analyse
    this.transition("supervisor_analyse")
    yield* this.drainEvents()

    while (this.canContinue()) {
      if (this.abortController.signal.aborted) {
        break
      }

      const phase = this.state!.currentPhase

      if (phase === "supervisor_analyse") {
        yield* this.runSupervisorAnalyse()
      } else if (phase === "worker_do") {
        yield* this.runWorkerDo()
      } else if (phase === "worker_report") {
        yield* this.runWorkerReport()
      } else if (phase === "supervisor_check") {
        yield* this.runSupervisorCheck()
      } else if (phase === "supervisor_intervene") {
        yield* this.runSupervisorIntervene()
      } else if (phase === "waiting_user") {
        yield* this.runWaitingUser()
      } else {
        break
      }
      yield* this.drainEvents()
    }

    // If we exited the loop without finishing, distinguish interrupt from max rounds
    if (this.state && !this.isFinished()) {
      if (this.abortController?.signal.aborted) {
        this.transition("blocked", "Interrupted by user")
      } else {
        this.transition("blocked", "Max rounds reached")
      }
    }
    yield* this.drainEvents()
  }

  private async *runSupervisorAnalyse(): AsyncGenerator<WorkflowEvent> {
    const supervisorInput = `Analyse the following goal and create a plan:\n\nGoal: ${this.state!.goal}\n\nProvide a structured plan with steps, constraints, and risks.`

    let errorMessage = ""
    // SFR-10: 使用 "loop" mode
    for await (const event of this.runtime!.getSupervisor().submit(supervisorInput, "loop")) {
      yield event as any
      if (event.role === "error") errorMessage = event.content ?? "Supervisor analysis failed"
    }

    const supervisorState = this.runtime!.getSupervisor().getState()
    const plan = supervisorState.messages.findLast(m => m.role === "assistant")?.content?.trim() ?? ""
    if (errorMessage || (this.config.requireSupervisorPlan && !plan)) {
      this.transition("blocked", errorMessage || "Supervisor did not produce a plan")
      return
    }
    this.setSupervisorPlan(plan)

    this.transition("worker_do")
  }

  private async *runWorkerDo(): AsyncGenerator<WorkflowEvent> {
    const workerInput = `Execute the following plan:\n\n${this.state!.supervisorPlan ?? ""}\n\nGoal: ${this.state!.goal}`

    let hasError = false
    let errorCount = 0

    // SFR-10: 使用 "loop" mode
    for await (const event of this.runtime!.getWorker().submit(workerInput, "loop")) {
      yield event as any
      if (event.role === "error") {
        hasError = true
        errorCount++
      }
    }

    // Check if Supervisor intervention is needed
    // Trigger intervention on repeated errors or explicit request
    if (hasError && errorCount >= 2 && this.state!.iteration < this.state!.maxRounds) {
      this.state!.lastInterventionReason = `Worker encountered ${errorCount} errors during execution`
      this.transition("supervisor_intervene")
      return
    }

    this.transition("worker_report")
  }

  private async *runWorkerReport(): AsyncGenerator<WorkflowEvent> {
    const workerInput = "Generate a summary report of what was accomplished."

    // SFR-10: 使用 "loop" mode
    for await (const event of this.runtime!.getWorker().submit(workerInput, "loop")) {
      yield event as any
    }

    const workerState = this.runtime!.getWorker().getState()
    const report = workerState.messages.findLast(m => m.role === "assistant")?.content ?? ""
    this.setWorkerReport(report)

    this.transition("supervisor_check")
  }

  private async *runSupervisorCheck(): AsyncGenerator<WorkflowEvent> {
    const supervisorInput = `Review the following worker report and decide next action:\n\nPlan: ${this.state!.supervisorPlan ?? ""}\n\nReport: ${this.state!.workerReport ?? ""}\n\nDecide: continue, revise, approve, ask_user, or blocked`

    // SFR-10: 使用 "loop" mode
    for await (const event of this.runtime!.getSupervisor().submit(supervisorInput, "loop")) {
      yield event as any
    }

    const supervisorState = this.runtime!.getSupervisor().getState()
    const response = supervisorState.messages.findLast(m => m.role === "assistant")?.content ?? ""

    const decision = this.parseDecision(response)

    if (decision === "approve") {
      this.transition("completed")
    } else if (decision === "ask_user") {
      const question = this.extractQuestion(response)
      yield* this.handleAskUser(question)
    } else if (decision === "blocked") {
      this.transition("blocked", response)
    } else {
      this.transition("worker_do")
    }
  }

  /**
   * 中途 Supervisor 干预 — 当 Worker 执行失败或需要指导时触发。
   * 与正式 supervisor_check 的区别：
   * - supervisor_check 在 WorkerReport 后执行，做出正式决策（approve/revise/continue）
   * - supervisor_intervene 在 WorkerDo 期间触发，提供中途指导（不决定是否完成）
   */
  private async *runSupervisorIntervene(): AsyncGenerator<WorkflowEvent> {
    if (!this.state) {
      return
    }

    const reason = this.state.lastInterventionReason ?? "Worker needs guidance"
    const workerState = this.runtime!.getWorker().getState()
    const recentMessages = workerState.messages.slice(-5)
    const contextSummary = recentMessages.map(m => `${m.role}: ${m.content?.slice(0, 200) ?? ""}`).join("\n")

    const supervisorInput = `The Worker is struggling and needs mid-workflow guidance.

Goal: ${this.state.goal}
Current Plan: ${this.state.supervisorPlan ?? "No plan yet"}
Intervention Reason: ${reason}

Recent Worker Context:
${contextSummary}

Provide brief guidance. Do NOT decide to approve or complete the workflow.
Return your guidance as structured advice.`

    // SFR-10: 使用 "loop" mode
    for await (const event of this.runtime!.getSupervisor().submit(supervisorInput, "loop")) {
      yield event as any
    }

    const supervisorState = this.runtime!.getSupervisor().getState()
    const guidance = supervisorState.messages.findLast(m => m.role === "assistant")?.content ?? ""

    // Emit mid-workflow intervention event (distinct from formal supervisor_check decision)
    this.emitEvent({
      type: "supervisor_intervene",
      workflowId: this.state.workflowId,
      phase: "supervisor_intervene",
      iteration: this.state.iteration,
      adviceSummary: guidance.slice(0, 500),
      reason,
      timestamp: Date.now(),
    })

    this.state.interventionCount++
    this.state.lastInterventionReason = undefined
    this.state.updatedAt = Date.now()

    // After intervention, return to worker_do with the guidance
    this.transition("worker_do")
  }

  private async *runWaitingUser(): AsyncGenerator<WorkflowEvent> {
    if (!this.state || !this.questionService) {
      return
    }

    const requestId = this.state.waitingUserRequestId
    if (!requestId) {
      return
    }

    try {
      await this.questionService.ask({
        sessionId: this.state.workflowId,
        questions: [{
          question: this.state.waitingUserQuestion ?? "User input needed",
          header: "Workflow needs input",
          options: [],
        }],
      })

      this.transition("supervisor_analyse")
    } catch {
      this.transition("blocked", "User rejected question")
    }
  }

  private async *handleAskUser(question: string): AsyncGenerator<WorkflowEvent> {
    if (!this.state || !this.questionService) {
      return
    }

    const requestId = randomUUID()
    this.state.waitingUserRequestId = requestId
    this.state.waitingUserQuestion = question
    this.state.updatedAt = Date.now()

    this.emitEvent({
      type: "ask_user",
      workflowId: this.state.workflowId,
      requestId,
      question,
      timestamp: Date.now(),
    })

    this.transition("waiting_user")
  }

  private parseDecision(response: string): WorkflowDecision {
    const lower = response.toLowerCase()
    if (lower.includes("approve") || lower.includes("completed")) return "approve"
    if (lower.includes("ask_user") || lower.includes("ask user")) return "ask_user"
    if (lower.includes("blocked") || lower.includes("cannot continue")) return "blocked"
    if (lower.includes("revise")) return "revise"
    return "continue"
  }

  private extractQuestion(response: string): string {
    const questionMatch = response.match(/question[:\s]*(.+)/i)
    return questionMatch?.[1]?.trim() ?? "Supervisor needs user input"
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
    this.pendingEvents = []
    this.abortController?.abort()
    this.abortController = undefined
  }

  interrupt(): void {
    this.abortController?.abort()
  }

  private isValidTransition(from: WorkflowPhase, to: WorkflowPhase): boolean {
    const validTransitions: Record<WorkflowPhase, WorkflowPhase[]> = {
      idle: ["supervisor_analyse", "blocked", "completed", "failed"],
      supervisor_analyse: ["worker_do", "waiting_user", "blocked", "completed", "failed"],
      worker_do: ["worker_report", "supervisor_intervene", "waiting_user", "blocked", "completed", "failed"],
      worker_report: ["supervisor_check", "blocked", "completed", "failed"],
      supervisor_check: ["supervisor_analyse", "worker_do", "completed", "waiting_user", "blocked", "failed"],
      supervisor_intervene: ["worker_do", "supervisor_check", "waiting_user", "blocked", "completed", "failed"],
      waiting_user: ["supervisor_analyse", "worker_do", "blocked", "completed", "failed"],
      blocked: ["supervisor_analyse", "completed", "failed"],
      completed: [],
      failed: [],
    }

    return validTransitions[from]?.includes(to) ?? false
  }

  private emitEvent(event: WorkflowEvent): void {
    this.pendingEvents.push(event)
    if (this.onEvent) {
      this.onEvent(event)
    }
  }

  private *drainEvents(): Generator<WorkflowEvent> {
    while (this.pendingEvents.length > 0) {
      yield this.pendingEvents.shift()!
    }
  }
}
