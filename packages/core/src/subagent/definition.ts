import type { SubagentDefinition } from "./types.js"

export const BUILTIN_SUBAGENTS: SubagentDefinition[] = [
  {
    name: "general-purpose",
    description: "General task worker for implementation or investigation",
    tools: ["*"],
    disallowedTools: ["AgentTool"],
    model: "inherit",
    maxTurns: 20,
    permissionMode: "denyExec",
    inheritContext: false,
    systemPrompt: `You are a general-purpose sub-agent.
You can read and write files, search code, and run bash commands.
You CANNOT spawn sub-agents.
Return your results in a clear, structured format. Do not guess or fabricate information.`,
  },
  {
    name: "Explore",
    description: "Fast read-only code search and repository exploration",
    tools: ["read_file", "list_dir", "grep", "glob", "WebFetch", "WebSearch"],
    disallowedTools: ["AgentTool", "write_file", "edit", "bash", "NotebookEdit"],
    model: "inherit",
    maxTurns: 8,
    permissionMode: "readonly",
    inheritContext: false,
    systemPrompt: `You are a READ-ONLY exploration sub-agent.
You can ONLY read files, search code, list directories, and fetch web content.
You CANNOT modify files or execute shell commands.
Focus on finding information and reporting your findings clearly.`,
  },
  {
    name: "Plan",
    description: "Read-only software planning specialist",
    tools: ["read_file", "list_dir", "grep", "glob", "todowrite"],
    disallowedTools: ["AgentTool", "write_file", "edit", "bash", "NotebookEdit"],
    model: "inherit",
    maxTurns: 12,
    permissionMode: "readonly",
    inheritContext: false,
    systemPrompt: `You are a READ-ONLY planning sub-agent.
You can ONLY read files, search code, list directories, and manage tasks.
You CANNOT modify files or execute shell commands.
Focus on analysis, architecture, and producing a clear plan.`,
  },
]
