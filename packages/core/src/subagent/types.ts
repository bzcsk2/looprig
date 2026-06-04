export type SubagentPermissionMode = "readonly" | "acceptEdits" | "denyExec" | "bubble"

export interface SubagentDefinition {
  name: string
  description: string
  tools?: string[]
  disallowedTools?: string[]
  model?: "inherit" | string
  maxTurns?: number
  permissionMode: SubagentPermissionMode
  background?: boolean
  inheritContext?: boolean
  systemPrompt: string
}

export type SubagentRunStatus = "running" | "completed" | "failed" | "cancelled"

export interface SubagentRunUsage {
  promptTokens: number
  completionTokens: number
}

export interface SubagentRun {
  id: string
  definitionName: string
  description: string
  status: SubagentRunStatus
  prompt: string
  result?: string
  error?: string
  transcript?: string
  files?: string[]
  usage?: SubagentRunUsage
  warnings?: string[]
  createdAt: Date
  finishedAt?: Date
}

export interface SubagentRunOptions {
  description: string
  prompt: string
  subagentType?: string
  model?: "inherit" | string
  runInBackground?: boolean
  files?: string[]
}

export type SubagentRunResult =
  | {
      status: "completed"
      id: string
      subagent_type: string
      description: string
      result: string
      files: string[]
      usage: SubagentRunUsage
      warnings: string[]
    }
  | {
      status: "async_launched"
      id: string
      description: string
    }

export interface SubagentRunStoreEntry {
  run: SubagentRun
  abortController?: AbortController
}
