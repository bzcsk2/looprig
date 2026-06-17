export type AgentRole = "worker" | "supervisor"

export type HarnessStrictness = "strict" | "normal" | "loose"

export type ThinkingMode = "off" | "open" | "high" | "max"

export interface AgentRoleProfile {
  role: AgentRole
  agent?: string
  modelTarget: string
  harness: HarnessStrictness
  thinking: ThinkingMode
  contextWindow?: number
  maxTokens?: number
  temperature?: number
  tools: {
    allow?: string[]
    deny?: string[]
  }
  plugins: string[]
  mcpServers: string[]
  skills: string[]
}

export interface AgentProfilesConfig {
  version: number
  worker: AgentRoleProfile
  supervisor: AgentRoleProfile
}

export const DEFAULT_AGENT_PROFILES: AgentProfilesConfig = {
  version: 1,
  worker: {
    role: "worker",
    agent: "worker",
    modelTarget: "zen/mimo-v2.5-free",
    harness: "normal",
    thinking: "high",
    tools: {},
    plugins: [],
    mcpServers: [],
    skills: [],
  },
  supervisor: {
    role: "supervisor",
    agent: "supervisor",
    modelTarget: "zen/mimo-v2.5-free",
    harness: "normal",
    thinking: "off",
    tools: {},
    plugins: [],
    mcpServers: [],
    skills: [],
  },
}
