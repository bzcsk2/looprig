import type { AgentRole } from "../agent-profile/types.js"
import type { LoopEvent, ChatClient, AgentTool } from "../interface.js"
import type { ChatMessage } from "../types.js"
import { AgentRuntime } from "./runtime.js"
import { PROVIDERS } from "../config.js"
import type {
  AgentRuntimeState,
  DualAgentRuntimeConfig,
  SendToOptions,
  InterruptRoleOptions,
} from "./types.js"

import type { ReasonixEngine } from "../engine.js"

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
  workerTools?: AgentTool[]
  supervisorTools?: AgentTool[]
  workerEngine?: ReasonixEngine
  supervisorEngine?: ReasonixEngine
}

function requiresApiKey(provider: string | undefined): boolean {
  if (!provider) return true
  const providerCfg = PROVIDERS[provider]
  if (!providerCfg) return true
  // 两种"不需要用户提供 key"的判定都要认：
  //   - keyless: true          （kilo/llm7 等完全无 key 通道）
  //   - requiresKey: false     （zen 等，有 defaultKey 兜底，用户无需提供）
  if (providerCfg.keyless) return false
  if (providerCfg.requiresKey === false) return false
  return true
}

export class DualAgentRuntime {
  private worker: AgentRuntime
  private supervisor: AgentRuntime
  private config: DualAgentRuntimeConfig
  private activeRole: AgentRole = "worker"

  constructor(options: DualAgentRuntimeOptions) {
    this.config = options.config

    // Validate required fields — apiKey only required for non-keyless providers
    const workerNeedsKey = requiresApiKey(options.workerConfig?.provider)
    const supervisorNeedsKey = requiresApiKey(options.supervisorConfig?.provider)
    if ((workerNeedsKey && !options.workerConfig?.apiKey) || !options.workerConfig?.baseUrl || !options.workerConfig?.model) {
      throw new Error("workerConfig is required with baseUrl and model (apiKey required for non-keyless providers)")
    }
    if ((supervisorNeedsKey && !options.supervisorConfig?.apiKey) || !options.supervisorConfig?.baseUrl || !options.supervisorConfig?.model) {
      throw new Error("supervisorConfig is required with baseUrl and model (apiKey required for non-keyless providers)")
    }

    this.worker = new AgentRuntime({
      role: "worker",
      client: options.workerClient,
      systemPrompt: options.workerSystemPrompt,
      contextWindow: 128_000,
      maxContextRounds: 20,
      config: options.workerConfig,
      tools: options.workerTools,
      engine: options.workerEngine,
    })

    this.supervisor = new AgentRuntime({
      role: "supervisor",
      client: options.supervisorClient,
      systemPrompt: options.supervisorSystemPrompt,
      contextWindow: 128_000,
      maxContextRounds: 20,
      config: options.supervisorConfig,
      tools: options.supervisorTools,
      engine: options.supervisorEngine,
    })
  }

  getWorker(): AgentRuntime {
    return this.worker
  }

  getSupervisor(): AgentRuntime {
    return this.supervisor
  }

  getConfig(): DualAgentRuntimeConfig {
    return { ...this.config }
  }

  /** WF-FIX-60: Load session on supervisor engine for dual-runtime session recovery */
  async loadSupervisorSession(sessionId: string): Promise<ChatMessage[]> {
    // The supervisor engine must implement loadSession (ReasonixEngine does)
    const engine = (this.supervisor as any).engine as import("../engine.js").ReasonixEngine | undefined
    if (engine?.loadSession) {
      return engine.loadSession(sessionId)
    }
    return []
  }

  getActiveRole(): AgentRole {
    return this.activeRole
  }

  getState(role: AgentRole): AgentRuntimeState {
    return role === "worker" ? this.worker.getState() : this.supervisor.getState()
  }

  async *sendDirect(options: SendToOptions): AsyncGenerator<LoopEvent> {
    const { role, input, mode } = options
    this.activeRole = role

    const runtime = role === "worker" ? this.worker : this.supervisor

    yield {
      role: "status",
      content: `Sending to ${role}`,
      metadata: { role, input, mode: mode ?? "alone" },
    }

    // SFR-10: 传递 mode 给 AgentRuntime
    for await (const event of runtime.submit(input, mode)) {
      yield event
    }

    yield {
      role: "status",
      content: `${role} completed`,
      metadata: { role },
    }
  }

  async *sendTo(role: AgentRole, input: string): AsyncGenerator<LoopEvent> {
    yield* this.sendDirect({ role, input })
  }

  interruptRole(options: InterruptRoleOptions | string): void {
    const role = typeof options === "string" ? options : options.role
    const runtime = role === "worker" ? this.worker : this.supervisor
    runtime.interrupt()
  }

  reset(): void {
    this.worker.reset()
    this.supervisor.reset()
    this.activeRole = "worker"
  }
}
