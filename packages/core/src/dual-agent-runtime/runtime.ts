import type { AgentRole } from "../agent-profile/types.js"
import type { ChatMessage } from "../types.js"
import type { LoopEvent, ChatClient, SessionStats, AgentTool } from "../interface.js"
import { ReasonixEngine } from "../engine.js"
import type { DeepreefConfig } from "../config.js"
import type { AgentRuntimeState, AgentRuntimeStatus } from "./types.js"

export interface AgentRuntimeOptions {
  role: AgentRole
  client: ChatClient
  systemPrompt: string
  contextWindow: number
  maxContextRounds: number
  config: {
    apiKey: string
    baseUrl: string
    model: string
    maxTokens: number
    temperature: number
    provider?: string
  }
  tools?: AgentTool[]
  engine?: ReasonixEngine
}

export class AgentRuntime {
  private role: AgentRole
  private engine: ReasonixEngine
  private systemPrompt: string
  private status: AgentRuntimeStatus = "idle"
  private currentTask?: string
  private startTime: number = 0

  constructor(options: AgentRuntimeOptions) {
    this.role = options.role
    this.systemPrompt = options.systemPrompt

    if (options.engine) {
      this.engine = options.engine
    } else {
      const deepreefConfig: DeepreefConfig = {
        apiKey: options.config.apiKey,
        baseUrl: options.config.baseUrl,
        model: options.config.model,
        maxTokens: options.config.maxTokens,
        temperature: options.config.temperature,
        contextWindow: options.contextWindow,
        maxContextRounds: options.maxContextRounds,
        provider: options.config.provider,
      }
      this.engine = new ReasonixEngine(deepreefConfig)
      this.engine.setSystemPrompt(options.systemPrompt)
    }

    if (options.tools) {
      for (const tool of options.tools) {
        this.engine.registerTool(tool)
      }
    }
  }

  getEngine(): ReasonixEngine {
    return this.engine
  }

  getRole(): AgentRole {
    return this.role
  }

  getStatus(): AgentRuntimeStatus {
    return this.status
  }

  getSystemPrompt(): string {
    return this.systemPrompt
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
    this.engine.setSystemPrompt(prompt)
  }

  getMessages(): ChatMessage[] {
    return this.engine.getState().messages
  }

  getState(): AgentRuntimeState {
    const engineState = this.engine.getState()
    return {
      role: this.role,
      status: this.status,
      currentTask: this.currentTask,
      messages: engineState.messages,
      stats: engineState.stats,
      elapsedMs: this.status === "running" ? Date.now() - this.startTime : 0,
    }
  }

  async *submit(input: string): AsyncGenerator<LoopEvent> {
    if (this.status === "running") {
      throw new Error(`Agent ${this.role} is already running`)
    }

    this.status = "running"
    this.startTime = Date.now()
    this.currentTask = input

    try {
      for await (const event of this.engine.submit(input)) {
        yield event
      }
      this.status = "completed"
    } catch (error) {
      this.status = "failed"
      yield {
        role: "error",
        content: error instanceof Error ? error.message : String(error),
      }
    } finally {
      this.currentTask = undefined
    }
  }

  interrupt(): void {
    if (this.status === "running") {
      this.engine.interrupt()
      this.status = "cancelled"
    }
  }

  reset(): void {
    this.status = "idle"
    this.currentTask = undefined
  }
}
