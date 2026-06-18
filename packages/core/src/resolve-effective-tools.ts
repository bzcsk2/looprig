import type { AgentTool } from "./interface.js"
import type { ToolSpec } from "./types.js"
import type { AgentRole } from "./agent-profile/types.js"
import type { WorkflowMode } from "./dual-agent-runtime/types.js"

const SUPERVISOR_TOOLS_SUBAGENT = new Set([
  "AgentTool",
  "AskUserQuestion",
  "read_file",
  "grep",
  "list_dir",
  "todowrite",
])

const SUPERVISOR_TOOLS_ALONE = new Set([
  "AskUserQuestion",
  "read_file",
  "grep",
  "list_dir",
  "todowrite",
])

const LOOP_ORCHESTRATION_TOOLS = new Set([
  "get_goal",
  "update_goal",
  "send_message",
  "followup_task",
  "read_mailbox",
])

const SUPERVISOR_LOOP_TOOLS = new Set([
  "get_goal",
  "update_goal",
])

export interface ResolveEffectiveToolsOpts {
  registeredTools: Map<string, AgentTool>
  role: AgentRole
  mode: WorkflowMode
  agentToolNames?: string[]
}

export interface ResolveEffectiveToolsResult {
  tools: ToolSpec[]
  filteredCount: number
  filteredReason?: string
}

export function resolveEffectiveTools(opts: ResolveEffectiveToolsOpts): ResolveEffectiveToolsResult {
  const { registeredTools, role, mode, agentToolNames } = opts
  const toolSpecs: ToolSpec[] = []
  let filteredCount = 0
  let filteredReason: string | undefined

  for (const tool of registeredTools.values()) {
    const name = tool.name

    // Loop is coordinator-orchestrated: Supervisor keeps goal governance tools,
    // but never receives mailbox or engineering tools.
    if (role === "supervisor" && mode === "loop") {
      if (SUPERVISOR_LOOP_TOOLS.has(name)) {
        toolSpecs.push(toSpec(tool))
        continue
      }
      filteredCount++
      if (!filteredReason) filteredReason = "supervisor loop mode: governance tools only"
      continue
    }

    // Worker loop gets only configured engineering tools. Goal/mailbox tools are
    // driven by WorkflowCoordinator so the fixed phase order stays intact.
    if (role === "worker" && mode === "loop") {
      if (LOOP_ORCHESTRATION_TOOLS.has(name)) {
        filteredCount++
        if (!filteredReason) filteredReason = "worker loop mode: goal/mailbox tools are coordinator-managed"
        continue
      }
      // For engineering tools, check agentToolNames
      if (agentToolNames !== undefined) {
        if (agentToolNames.length === 0) {
          filteredCount++
          if (!filteredReason) filteredReason = "agent config toolNames is empty array"
          continue
        }
        if (!agentToolNames.includes(name)) {
          filteredCount++
          continue
        }
      }
      toolSpecs.push(toSpec(tool))
      continue
    }

    // Worker non-loop: delegate to agentToolNames if specified
    if (role === "worker" && mode !== "loop") {
      if (agentToolNames !== undefined) {
        if (agentToolNames.length === 0) {
          filteredCount++
          if (!filteredReason) filteredReason = "agent config toolNames is empty array"
          continue
        }
        if (!agentToolNames.includes(name)) {
          filteredCount++
          continue
        }
      }
      toolSpecs.push(toSpec(tool))
      continue
    }

    // Supervisor alone/subagent
    if (role === "supervisor") {
      if (mode === "alone" && !SUPERVISOR_TOOLS_ALONE.has(name)) {
        filteredCount++
        if (!filteredReason) filteredReason = "supervisor alone mode: restricted toolset"
        continue
      }
      if (mode === "subagent" && !SUPERVISOR_TOOLS_SUBAGENT.has(name)) {
        filteredCount++
        if (!filteredReason) filteredReason = "supervisor subagent mode: restricted toolset"
        continue
      }
    }

    // Default: allow through agentToolNames if set
    if (agentToolNames !== undefined) {
      if (agentToolNames.length === 0) {
        filteredCount++
        if (!filteredReason) filteredReason = "agent config toolNames is empty array"
        continue
      }
      if (!agentToolNames.includes(name)) {
        filteredCount++
        continue
      }
    }

    toolSpecs.push(toSpec(tool))
  }

  return { tools: toolSpecs, filteredCount, filteredReason }
}

function toSpec(tool: AgentTool): ToolSpec {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}
