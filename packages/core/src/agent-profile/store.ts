import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
import type { AgentProfilesConfig, AgentRoleProfile } from "./types.js"
import { DEFAULT_AGENT_PROFILES } from "./types.js"
import { validateAgentProfiles } from "./schema.js"

const AGENTS_CONFIG_FILE = ".deepreef/agents.json"

interface LegacyConfig {
  agent?: string
  thinkingMode?: string
  activeSkills?: Array<{ name: string }>
  harness?: {
    strictness?: string
  }
}

function loadLegacyConfig(): LegacyConfig | null {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".deepreef/ui-settings.json"), "utf8")
    return JSON.parse(raw) as LegacyConfig
  } catch {
    return null
  }
}

function isThinkingMode(value: string | undefined): value is "off" | "open" | "high" | "max" {
  return value === "off" || value === "open" || value === "high" || value === "max"
}

function migrateLegacyConfig(legacy: LegacyConfig): AgentProfilesConfig {
  const config = { ...DEFAULT_AGENT_PROFILES }

  if (isThinkingMode(legacy.thinkingMode)) {
    config.worker.thinking = legacy.thinkingMode
    config.supervisor.thinking = legacy.thinkingMode === "high" ? "off" : legacy.thinkingMode
  }

  if (legacy.activeSkills) {
    const skillNames = legacy.activeSkills.map((s) => s.name)
    config.worker.skills = skillNames
  }

  if (legacy.harness?.strictness === "strict" || legacy.harness?.strictness === "normal" || legacy.harness?.strictness === "loose") {
    config.worker.harness = legacy.harness.strictness
    config.supervisor.harness = legacy.harness.strictness
  }

  return config
}

export function loadAgentProfiles(): AgentProfilesConfig {
  try {
    const raw = readFileSync(resolve(process.cwd(), AGENTS_CONFIG_FILE), "utf8")
    const parsed = JSON.parse(raw)

    if (parsed.build || parsed.plan) {
      const migrated = migrateLegacyFromOldFormat(parsed)
      saveAgentProfiles(migrated)
      return migrated
    }

    const validation = validateAgentProfiles(parsed)
    if (validation.success) {
      return validation.data
    }

    console.error(`[agent-profile] Invalid config, using defaults: ${validation.error}`)
    return DEFAULT_AGENT_PROFILES
  } catch {
    const legacy = loadLegacyConfig()
    if (legacy) {
      const migrated = migrateLegacyConfig(legacy)
      saveAgentProfiles(migrated)
      return migrated
    }
    return DEFAULT_AGENT_PROFILES
  }
}

function migrateLegacyFromOldFormat(parsed: Record<string, unknown>): AgentProfilesConfig {
  const config = { ...DEFAULT_AGENT_PROFILES }

  const buildProfile = parsed.build as Partial<AgentRoleProfile> | undefined
  const planProfile = parsed.plan as Partial<AgentRoleProfile> | undefined

  if (buildProfile) {
    config.worker = { ...config.worker, ...buildProfile, role: "worker" }
  }

  if (planProfile) {
    config.supervisor = { ...config.supervisor, ...planProfile, role: "supervisor" }
  }

  return config
}

export function saveAgentProfiles(config: AgentProfilesConfig): void {
  try {
    const dir = join(process.cwd(), ".deepreef")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(join(dir, "agents.json"), JSON.stringify(config, null, 2), "utf8")
  } catch (error) {
    console.error("[agent-profile] Failed to save config:", error)
  }
}

export function getAgentProfile(config: AgentProfilesConfig, role: "worker" | "supervisor"): AgentRoleProfile {
  return role === "worker" ? config.worker : config.supervisor
}

export function updateAgentProfile(
  config: AgentProfilesConfig,
  role: "worker" | "supervisor",
  updates: Partial<AgentRoleProfile>
): AgentProfilesConfig {
  const newConfig = { ...config }
  if (role === "worker") {
    newConfig.worker = { ...newConfig.worker, ...updates, role: "worker" }
  } else {
    newConfig.supervisor = { ...newConfig.supervisor, ...updates, role: "supervisor" }
  }
  return newConfig
}
