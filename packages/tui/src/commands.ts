/**
 * CL-52: Slash command parsing and routing — pure logic, no React dependency.
 * Testable without rendering any Ink components.
 */

import { AGENTS, defaultAgentRegistry } from "@deepreef/core"

export type SlashCommand =
  | { name: "exit" }
  | { name: "help" }
  | { name: "model" }
  | { name: "sessions" }
  | { name: "skill" }
  | { name: "agent" }
  | { name: "thinking"; mode: string }
  | { name: "lang" }
  | { name: "status" }
  | { name: "context" }
  | { name: "harness"; subcommand?: "status" | "strict" | "normal" | "loose" | "project"; arg?: string }
  | { name: "theme"; themeName?: string }
  | { name: "workflow" }
  | { name: "talk"; role?: "worker" | "supervisor" }
  | { name: "goal"; subcommand?: "status" | "edit" | "pause" | "resume" | "clear" | "budget" | "no-budget"; arg?: string; objective?: string }

const THINKING_MODES = ["off", "high", "max"]

/**
 * CL-52: Parse a slash command from user input.
 * Returns null if the input is not a slash command.
 */
export function parseSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return null

  if (trimmed === "/exit" || trimmed === "/bye") return { name: "exit" }
  if (trimmed === "/help") return { name: "help" }
  if (trimmed === "/model") return { name: "model" }
  if (trimmed === "/sessions") return { name: "sessions" }
  if (trimmed === "/skill") return { name: "skill" }
  if (trimmed === "/agent") return { name: "agent" }
  if (trimmed === "/lang") return { name: "lang" }
  if (trimmed === "/status") return { name: "status" }
  if (trimmed === "/context") return { name: "context" }
  if (trimmed.startsWith("/theme")) {
    const parts = trimmed.split(/\s+/)
    const themeName = parts[1]
    return { name: "theme", themeName }
  }

  if (trimmed.startsWith("/thinking")) {
    const parts = trimmed.split(/\s+/)
    const mode = parts[1]
    return { name: "thinking", mode: mode ?? "" }
  }

  if (trimmed.startsWith("/harness")) {
    const parts = trimmed.split(/\s+/)
    const sub = parts[1]
    if (sub === "status" || sub === "strict" || sub === "normal" || sub === "loose") {
      return { name: "harness" as const, subcommand: sub as "status" | "strict" | "normal" | "loose" }
    }
    if (sub === "project") {
      return { name: "harness" as const, subcommand: "project" as const, arg: parts[2] }
    }
    return { name: "harness" as const }
  }

  if (trimmed === "/workflow" || trimmed.startsWith("/workflow")) {
    return { name: "workflow" }
  }

  if (trimmed.startsWith("/talk")) {
    const parts = trimmed.split(/\s+/)
    const role = parts[1] as "worker" | "supervisor" | undefined
    if (role && role !== "worker" && role !== "supervisor") return null
    return { name: "talk", role }
  }

  if (trimmed.startsWith("/goal")) {
    const parts = trimmed.split(/\s+/)
    if (parts.length === 1) return { name: "goal" }
    const sub = parts[1]
    if (sub === "edit" && parts[2]) return { name: "goal", subcommand: "edit", arg: parts.slice(2).join(" ") }
    if (sub === "edit") return { name: "goal", subcommand: "edit" }
    if (sub === "pause") return { name: "goal", subcommand: "pause" }
    if (sub === "resume") return { name: "goal", subcommand: "resume" }
    if (sub === "clear") return { name: "goal", subcommand: "clear" }
    if (sub === "no-budget") return { name: "goal", subcommand: "no-budget" }
    if (sub === "budget" && parts[2]) return { name: "goal", subcommand: "budget", arg: parts[2] }
    // /goal <objective> — 剩余部分作为 objective
    const rest = parts.slice(1).join(" ")
    return { name: "goal", subcommand: "status", objective: rest }
  }

  return null
}

/**
 * CL-52: Validate a thinking mode argument.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateThinkingMode(mode: string): string | null {
  if (!mode || !THINKING_MODES.includes(mode)) {
    return `Usage: /thinking <mode>\nModes: ${THINKING_MODES.join(", ")}`
  }
  return null
}

/**
 * CL-52: Get the valid thinking modes list.
 */
export function getThinkingModes(): string[] {
  return [...THINKING_MODES]
}

/**
 * Cycle to the next agent.
 * Returns the next agent name and its label.
 */
export function toggleAgent(current: string): { next: string; label: string } {
  const agents = defaultAgentRegistry.list()
  const names = agents.map(a => a.name)
  if (names.length === 0) return { next: current, label: current }
  const idx = names.indexOf(current)
  const next = idx >= 0 && idx < names.length - 1 ? names[idx + 1] : names[0]
  const def = defaultAgentRegistry.get(next)
  return { next, label: def?.label ?? next }
}

/**
 * CL-52: Build the /help text.
 */
interface HelpCommandStrings {
  cmdExit: string
  cmdHelp: string
  cmdModel: string
  cmdSessions: string
  cmdAgent: string
  cmdSkill: string
  cmdLang: string
  cmdStatus: string
  cmdContext: string
}

export function buildHelpText(activeAgent: string, cmdStrings: HelpCommandStrings): string {
  const agentList = defaultAgentRegistry.list()
    .map((a) => `${a.name} — ${a.label}`)
    .join("\n")
  const currentLabel = defaultAgentRegistry.get(activeAgent)?.label ?? AGENTS[activeAgent]?.label ?? activeAgent

  return [
    "Commands:",
    `  /exit, /bye  — ${cmdStrings.cmdExit}`,
    `  /help        — ${cmdStrings.cmdHelp}`,
    `  /model       — ${cmdStrings.cmdModel}`,
    `  /sessions    — ${cmdStrings.cmdSessions}`,
    `  /agent       — ${cmdStrings.cmdAgent}`,
    `  /skill       — ${cmdStrings.cmdSkill}`,
    `  /lang        — ${cmdStrings.cmdLang}`,
    `  /status      — ${cmdStrings.cmdStatus}`,
    `  /context     — ${cmdStrings.cmdContext}`,
    `  /theme       — list or switch theme`,
    `  /thinking    — set thinking mode`,
    `  /workflow    — switch workflow mode (alone | subagent | loop)`,
    `  /talk [role] — switch input target (worker|supervisor)`,
    `  /goal        — show/set goal status`,
    `  /goal <obj>  — set goal objective`,
    `  /goal edit   — edit goal objective prompt`,
    `  /goal pause  — pause goal tracking`,
    `  /goal resume — resume goal tracking`,
    `  /goal clear  — clear current goal`,
    `  /goal budget — set token budget for goal`,
    `  /goal no-budget — unlimited token budget`,
    "",
    "Agents:",
    agentList,
    "",
    `Current: ${currentLabel}`,
    "",
    "Note: /agent build|plan commands are deprecated.",
    "Use dual-role mode with Worker/Supervisor instead.",
  ].join("\n")
}

/**
 * CL-52: Format a skill list result for display.
 */
export function formatSkillList(resultContent: string, loadedStr: (count: number) => string): string {
  try {
    const d = JSON.parse(resultContent)
    const lines = d.skills
      .slice(0, 20)
      .map((s: { name: string; description: string }) => `  ${s.name} — ${s.description}`)
      .join("\n")
    const more = d.count > 20 ? `\n  ... and ${d.count - 20} more` : ""
    return `${loadedStr(d.count)}${lines}${more}`
  } catch {
    return resultContent
  }
}
