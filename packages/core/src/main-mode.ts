export type MainMode = "plan" | "build"

export interface MainModeDefinition {
  name: MainMode
  label: string
  systemPrompt: string
  toolNames: string[]
  permissionProfile: "readonly" | "build"
}

export const MAIN_MODES: Record<MainMode, MainModeDefinition> = {
  build: {
    name: "build",
    label: "Build Mode",
    systemPrompt: `You are a full-stack engineering agent with access to a complete toolset.
You can read, write, edit files, run bash commands, search code, and manage tasks.
Always verify your changes — re-read files after editing when needed.`,
    toolNames: [
      "bash", "read_file", "write_file", "edit", "list_dir", "grep", "todowrite", "glob",
      "WebFetch", "WebSearch", "Skill", "ListMcpResources", "ReadMcpResource", "McpAuth",
      "ListMcpTools", "CallMcpTool", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
      "TaskStop", "AskUserQuestion", "PlanMode", "NotebookEdit", "Sleep", "PushNotification",
      "Monitor", "WebBrowser", "Worktree", "Cron", "Workflow", "AgentTool", "SendMessage", "LSP",
    ],
    permissionProfile: "build",
  },
  plan: {
    name: "plan",
    label: "Plan Mode",
    systemPrompt: `You are a planning agent with read-only access.
You can read files, search code, list directories, and manage tasks — but you can NOT modify files or run commands.
Focus on analysis, planning, and providing actionable recommendations for the Build Agent.`,
    toolNames: ["read_file", "list_dir", "grep", "todowrite"],
    permissionProfile: "readonly",
  },
}

export function getMainMode(name: string): MainModeDefinition {
  if (name === "plan") return MAIN_MODES.plan
  return MAIN_MODES.build
}
