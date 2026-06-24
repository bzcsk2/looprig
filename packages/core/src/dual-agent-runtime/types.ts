import type { AgentRole } from "../agent-profile/types.js"
import type { ChatMessage } from "../types.js"
import type { LoopEvent } from "../interface.js"
import type { ThinkingMode } from "../provider-thinking.js"

/* SFR-10: 提交场景上下文 */
export type WorkflowMode = "alone" | "subagent" | "loop"

export interface SubmitContext {
  role: AgentRole
  mode: WorkflowMode
}

export type AgentRuntimeStatus =
  | "idle"
  | "running"
  | "waiting_permission"
  | "waiting_question"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"

export interface AgentRuntimeState {
  role: AgentRole
  status: AgentRuntimeStatus
  currentTask?: string
  messages: ChatMessage[]
  stats: {
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
    cacheMissTokens: number
    apiCalls: number
    toolCalls: number
    totalCost: number
  }
  elapsedMs: number
}

export interface DualAgentRuntimeConfig {
  workerModelTarget: string
  supervisorModelTarget: string
  workerThinking: ThinkingMode
  supervisorThinking: ThinkingMode
  maxWorkflowRounds: number
}

export interface SendToOptions {
  role: AgentRole
  input: string
  mode?: WorkflowMode
  workflowId?: string
}

export interface InterruptRoleOptions {
  role: AgentRole
  reason?: string
}
