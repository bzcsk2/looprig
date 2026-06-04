import type { SubagentPermissionMode } from "./types.js"

const WRITE_TOOLS = new Set(["write_file", "edit", "NotebookEdit", "patch"])
const EXEC_TOOLS = new Set(["bash", "exec"])

export function getToolTier(toolName: string): "read" | "write" | "exec" {
  if (EXEC_TOOLS.has(toolName)) return "exec"
  if (WRITE_TOOLS.has(toolName)) return "write"
  return "read"
}

export interface SubagentPermissionCheck {
  allowed: boolean
  reason?: string
}

export function checkSubagentPermission(
  toolName: string,
  permissionMode: SubagentPermissionMode,
): SubagentPermissionCheck {
  switch (permissionMode) {
    case "readonly": {
      const tier = getToolTier(toolName)
      if (tier === "write" || tier === "exec") {
        return { allowed: false, reason: `Subagent in readonly mode cannot use tool: ${toolName}` }
      }
      return { allowed: true }
    }

    case "denyExec": {
      const tier = getToolTier(toolName)
      if (tier === "exec") {
        return { allowed: false, reason: `Subagent in denyExec mode cannot run exec tool: ${toolName}` }
      }
      return { allowed: true }
    }

    case "acceptEdits":
      return { allowed: true }

    case "bubble":
      return { allowed: true }

    default:
      return { allowed: false, reason: `Unknown permission mode: ${permissionMode}` }
  }
}
