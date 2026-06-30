import type { SubagentDefinition } from "./types.js"
import { getPromptLocale } from "../prompt-locale.js"

export function getSubagentSystemPrompt(def: SubagentDefinition, locale = getPromptLocale()): string {
  if (locale !== "zh-CN" && def.systemPromptByLocale?.en) {
    return def.systemPromptByLocale.en
  }
  if (locale === "zh-CN" && def.systemPromptByLocale?.["zh-CN"]) {
    return def.systemPromptByLocale["zh-CN"]
  }
  return def.systemPrompt
}

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
    systemPromptByLocale: {
      "zh-CN": `你是一个通用子代理（general-purpose sub-agent）。
你可以读写文件、搜索代码、运行 bash 命令。
你不能再派生子代理。
用清晰的结构化格式返回结果。不要猜测或编造信息。`,
    },
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
    systemPromptByLocale: {
      "zh-CN": `你是一个只读的探索性子代理（Explore sub-agent）。
你只能读取文件、搜索代码、列出目录和获取网络内容。
你不能修改文件或执行 shell 命令。
专注于查找信息并清晰地报告你的发现。`,
    },
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
    systemPromptByLocale: {
      "zh-CN": `你是一个只读的规划性子代理（Plan sub-agent）。
你只能读取文件、搜索代码、列出目录和管理任务。
你不能修改文件或执行 shell 命令。
专注于分析、架构和制定清晰的计划。`,
    },
  },
]
