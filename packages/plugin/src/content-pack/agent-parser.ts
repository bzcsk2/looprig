import { readFileSync } from "node:fs"
import type { AgentDefinition } from "@covalo/core"

const FRONTMATTER_RE = /^---\n([\s\S]+?)\n---\n([\s\S]*)$/

const COVALO_TOOL_MAP: Record<string, string> = {
  Read: "read_file",
  Write: "write_file",
  Edit: "edit",
  MultiEdit: "edit",
  Bash: "bash",
  Grep: "grep",
  Glob: "glob",
  TodoWrite: "todo_write",
  ListDir: "list_dir",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  Skill: "Skill",
  Task: "task_create",
  AskUser: "ask_user_question",
  Notebook: "notebook_edit",
  Sleep: "sleep",
}

export interface AgentParseResult {
  agent?: AgentDefinition
  warnings: string[]
}

export function parseEccAgentMarkdown(filePath: string): AgentParseResult {
  const warnings: string[] = []

  try {
    const raw = readFileSync(filePath, "utf8")
    const match = raw.match(FRONTMATTER_RE)
    if (!match) {
      return { warnings: [`No frontmatter found in ${filePath}`] }
    }

    const frontmatter: Record<string, unknown> = {}
    for (const line of match[1].split("\n")) {
      const colon = line.indexOf(":")
      if (colon > 0) {
        const key = line.slice(0, colon).trim()
        const rawVal = line.slice(colon + 1).trim()
        let val: unknown = rawVal
        if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
          try { val = JSON.parse(rawVal) } catch { /* keep string */ }
        } else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
          val = rawVal.slice(1, -1)
        } else if (rawVal.startsWith("'") && rawVal.endsWith("'")) {
          val = rawVal.slice(1, -1)
        } else if (rawVal === "true") val = true
        else if (rawVal === "false") val = false
        frontmatter[key] = val
      }
    }

    const name = frontmatter.name as string | undefined
    if (!name) {
      return { warnings: [`Agent file ${filePath} missing name in frontmatter`] }
    }

    const description = (frontmatter.description as string) ?? ""
    const model = frontmatter.model as string | undefined

    // Map tools
    const eccTools = frontmatter.tools
    const toolNames: string[] = []
    if (Array.isArray(eccTools)) {
      for (const t of eccTools) {
        const mapped = COVALO_TOOL_MAP[t as string]
        if (mapped) {
          toolNames.push(mapped)
        } else {
          warnings.push(`Unknown tool "${t}" in agent "${name}", skipping`)
        }
      }
    }

    // Body is the entire content after frontmatter, used as system prompt
    const body = match[2].trim()

    return {
      agent: {
        name: `ecc:${name}`,
        label: `ECC ${description.split(".")[0] ?? name}`,
        model: model && !["sonnet", "opus", "haiku"].includes(model) ? model : undefined,
        systemPrompt: body,
        toolNames: toolNames.length > 0 ? toolNames : undefined,
      },
      warnings,
    }
  } catch (e) {
    return { warnings: [`Failed to parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`] }
  }
}
