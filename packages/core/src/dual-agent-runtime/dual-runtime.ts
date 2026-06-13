import type { AgentRole } from "../agent-profile/types.js"
import type { LoopEvent, ChatClient } from "../interface.js"
import { AgentRuntime } from "./runtime.js"
import type {
  AgentRuntimeState,
  DualAgentRuntimeConfig,
  WorkflowState,
  WorkflowPhase,
  SendToOptions,
  InterruptRoleOptions,
} from "./types.js"
import { randomUUID } from "node:crypto"

export interface DualAgentRuntimeOptions {
  workerClient: ChatClient
  supervisorClient: ChatClient
  workerSystemPrompt: string
  supervisorSystemPrompt: string
  config: DualAgentRuntimeConfig
  workerConfig: {
    apiKey: string
    baseUrl: string
    model: string
    maxTokens: number
    temperature: number
    provider?: string
  }
  supervisorConfig: {
    apiKey: string
    baseUrl: string
    model: string
    maxTokens: number
    temperature: number
    provider?: string
  }
}

export class DualAgentRuntime {
  private worker: AgentRuntime
  private supervisor: AgentRuntime
  private config: DualAgentRuntimeConfig
  private workflow: WorkflowState
  private activeRole: AgentRole = "worker"

  constructor(options: DualAgentRuntimeOptions) {
    this.config = options.config

    this.worker = new AgentRuntime({
      role: "worker",
      client: options.workerClient,
      systemPrompt: options.workerSystemPrompt,
      contextWindow: 128_000,
      maxContextRounds: 20,
      config: options.workerConfig,
    })

    this.supervisor = new AgentRuntime({
      role: "supervisor",
      client: options.supervisorClient,
      systemPrompt: options.supervisorSystemPrompt,
      contextWindow: 128_000,
      maxContextRounds: 20,
      config: options.supervisorConfig,
    })

    this.workflow = {
      workflowId: randomUUID(),
      currentRound: 0,
      maxRounds: this.config.maxWorkflowRounds,
      currentPhase: "idle",
      history: [],
    }
  }

  getWorker(): AgentRuntime {
    return this.worker
  }

  getSupervisor(): AgentRuntime {
    return this.supervisor
  }

  getActiveRole(): AgentRole {
    return this.activeRole
  }

  getWorkflow(): WorkflowState {
    return { ...this.workflow }
  }

  getState(role: AgentRole): AgentRuntimeState {
    return role === "worker" ? this.worker.getState() : this.supervisor.getState()
  }

  async *sendTo(options: SendToOptions): AsyncGenerator<LoopEvent> {
    const { role, input } = options
    this.activeRole = role

    const runtime = role === "worker" ? this.worker : this.supervisor

    yield {
      role: "status",
      content: `Sending to ${role}`,
      metadata: { role, input },
    }

    for await (const event of runtime.submit(input)) {
      yield event
    }

    yield {
      role: "status",
      content: `${role} completed`,
      metadata: { role },
    }
  }

  interruptRole(options: InterruptRoleOptions): void {
    const { role } = options
    const runtime = role === "worker" ? this.worker : this.supervisor
    runtime.interrupt()
  }

  transitionWorkflow(to: WorkflowPhase): void {
    const from = this.workflow.currentPhase
    this.workflow.history.push(from)
    this.workflow.currentPhase = to

    if (to === "supervisor_analyse") {
      this.workflow.currentRound++
    }
  }

  canContinue(): boolean {
    return this.workflow.currentRound < this.workflow.maxRounds
  }

  reset(): void {
    this.worker.reset()
    this.supervisor.reset()
    this.activeRole = "worker"
    this.workflow = {
      workflowId: randomUUID(),
      currentRound: 0,
      maxRounds: this.config.maxWorkflowRounds,
      currentPhase: "idle",
      history: [],
    }
  }
}
