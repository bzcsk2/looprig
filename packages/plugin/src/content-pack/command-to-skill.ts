import { readFileSync } from "node:fs"
import type { ContentAsset } from "./types.js"

const FRONTMATTER_RE = /^---\n([\s\S]+?)\n---\n([\s\S]*)$/

export interface CommandSkillEntry {
  name: string
  description: string
  content: string
}

export function convertCommandsToSkills(commands: ContentAsset[]): { skills: CommandSkillEntry[]; warnings: string[] } {
  const warnings: string[] = []
  const skills: CommandSkillEntry[] = []

  for (const cmd of commands) {
    try {
      const raw = readFileSync(cmd.path, "utf8")
      const match = raw.match(FRONTMATTER_RE)
      const description = match
        ? (match[1].match(/description:\s*(.+)/)?.[1]?.trim() ?? "")
        : ""
      const body = match
        ? match[2].trim()
        : raw.trim()

      const skillName = `ecc-command:${cmd.id}`
      const skillDescription = description || `ECC command:${cmd.id}`

      skills.push({
        name: skillName,
        description: skillDescription,
        content: body,
      })
    } catch (e) {
      warnings.push(`Failed to read command "${cmd.id}" at ${cmd.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { skills, warnings }
}
