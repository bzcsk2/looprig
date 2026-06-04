import type { AgentConfig } from "./interface.js"
import { MAIN_MODES, getMainMode } from "./main-mode.js"
import type { MainMode } from "./main-mode.js"

export type { MainMode } from "./main-mode.js"
export { MAIN_MODES, getMainMode } from "./main-mode.js"

export interface AgentDefinition {
  name: string
  label: string
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  toolNames?: string[]
}

export const AGENTS: Record<string, AgentDefinition> = {
  build: {
    name: "build",
    label: "Build Mode",
    systemPrompt: MAIN_MODES.build.systemPrompt,
    toolNames: [...MAIN_MODES.build.toolNames],
  },
  plan: {
    name: "plan",
    label: "Plan Mode",
    systemPrompt: MAIN_MODES.plan.systemPrompt,
    toolNames: [...MAIN_MODES.plan.toolNames],
  },
}

export function getAgent(name: string): AgentDefinition {
  return AGENTS[name] ?? AGENTS.build
}

export function agentConfigFor(name: string, overrides?: Partial<AgentConfig>): AgentConfig {
  const def = getAgent(name)
  return {
    name: def.name,
    model: overrides?.model,
    temperature: overrides?.temperature,
    maxTokens: overrides?.maxTokens,
    systemPrompt: overrides?.systemPrompt ?? def.systemPrompt,
    toolNames: overrides?.toolNames ?? def.toolNames,
  }
}
