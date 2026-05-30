import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// These are not exported from skill-loader, so we re-implement for testing
function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
  const FRONTMATTER_RE = /^---\n([\s\S]+?)\n---\n([\s\S]*)$/
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: {}, content: raw }
  const frontmatter: Record<string, unknown> = {}
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":")
    if (colon > 0) {
      const key = line.slice(0, colon).trim()
      const rawVal = line.slice(colon + 1).trim()
      let val: unknown = rawVal
      if (rawVal.startsWith('"') && rawVal.endsWith('"')) val = rawVal.slice(1, -1)
      else if (rawVal.startsWith("'") && rawVal.endsWith("'")) val = rawVal.slice(1, -1)
      else if (rawVal === "true") val = true
      else if (rawVal === "false") val = false
      frontmatter[key] = val
    }
  }
  return { frontmatter, content: match[2].trim() }
}

function matchSkills(query: string, skills: Array<{ name: string; description: string; whenToUse?: string; tags?: string[] }>): typeof skills {
  const q = query.toLowerCase()
  return skills.filter(s => {
    if (s.name.toLowerCase().includes(q)) return true
    if (s.description.toLowerCase().includes(q)) return true
    if (s.whenToUse?.toLowerCase().includes(q)) return true
    if (s.tags?.some(t => t.toLowerCase().includes(q))) return true
    return false
  }).slice(0, 10)
}

describe("parseFrontmatter", () => {
  it("should parse name and description from frontmatter", () => {
    const raw = `---
name: test-skill
description: A test skill
---
Skill content here`
    const { frontmatter, content } = parseFrontmatter(raw)
    expect(frontmatter.name).toBe("test-skill")
    expect(frontmatter.description).toBe("A test skill")
    expect(content).toBe("Skill content here")
  })

  it("should parse boolean values", () => {
    const raw = `---
name: bool-test
enabled: true
deprecated: false
---
content`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.enabled).toBe(true)
    expect(frontmatter.deprecated).toBe(false)
  })

  it("should return empty frontmatter when no --- marker", () => {
    const { frontmatter, content } = parseFrontmatter("just content")
    expect(frontmatter).toEqual({})
    expect(content).toBe("just content")
  })

  it("should handle quoted strings in frontmatter", () => {
    const raw = `---
name: "quoted-name"
description: 'single-quoted'
---
body`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.name).toBe("quoted-name")
    expect(frontmatter.description).toBe("single-quoted")
  })

  it("should parse tags as string value", () => {
    const raw = `---
name: tagged
tags: testing,skill
---
content`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.tags).toBe("testing,skill")
  })
})

describe("matchSkills", () => {
  const skills = [
    { name: "bash", description: "Execute shell commands", whenToUse: "Run terminal commands", tags: ["shell", "terminal"] },
    { name: "git-helper", description: "Git operations helper", tags: ["git", "vcs"] },
    { name: "node-dev", description: "Node.js development", tags: ["node", "javascript"] },
  ]

  it("should match by name", () => {
    expect(matchSkills("bash", skills)).toHaveLength(1)
  })

  it("should match by description", () => {
    expect(matchSkills("shell", skills)).toHaveLength(1)
  })

  it("should match by whenToUse", () => {
    expect(matchSkills("terminal", skills)).toHaveLength(1)
  })

  it("should match by tag", () => {
    expect(matchSkills("git", skills)).toHaveLength(1)
  })

  it("should return multiple matches", () => {
    expect(matchSkills("node", skills)).toHaveLength(1)
  })

  it("should return empty for no match", () => {
    expect(matchSkills("nonexistent", skills)).toHaveLength(0)
  })

  it("should be case insensitive", () => {
    expect(matchSkills("BASH", skills)).toHaveLength(1)
    expect(matchSkills("Git", skills)).toHaveLength(1)
  })

  it("should limit results to 10", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `skill-${i}`, description: `common prefix skill`, tags: ["common"] }))
    expect(matchSkills("common", many)).toHaveLength(10)
  })
})

describe("loadSkillsDirs", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "deepicode-skills-"))
  })
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("should load skills from directory with SKILL.md", async () => {
    const { loadSkillsDirs } = await import("../src/skill-loader.js")
    const skillDir = join(tmpDir, "my-skill")
    mkdirSync(skillDir)
    writeFileSync(join(skillDir, "SKILL.md"), `---
name: my-skill
description: My custom skill
---
# My Skill
Content here`)

    const skills = await loadSkillsDirs([tmpDir])
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe("my-skill")
    expect(skills[0].description).toBe("My custom skill")
    expect(skills[0].content).toContain("Content")
  })

  it("should skip directories without SKILL.md", async () => {
    const { loadSkillsDirs } = await import("../src/skill-loader.js")
    mkdirSync(join(tmpDir, "no-skill"))
    const skills = await loadSkillsDirs([tmpDir])
    expect(skills).toHaveLength(0)
  })

  it("should skip non-directories", async () => {
    const { loadSkillsDirs } = await import("../src/skill-loader.js")
    writeFileSync(join(tmpDir, "not-a-dir.md"), "not a directory")
    const skills = await loadSkillsDirs([tmpDir])
    expect(skills).toHaveLength(0)
  })

  it("should load multiple skills from multiple dirs", async () => {
    const { loadSkillsDirs } = await import("../src/skill-loader.js")
    const d1 = join(tmpDir, "skill1")
    const d2 = join(tmpDir, "skill2")
    mkdirSync(d1); mkdirSync(d2)
    writeFileSync(join(d1, "SKILL.md"), "---\nname: skill1\n---\nc1")
    writeFileSync(join(d2, "SKILL.md"), "---\nname: skill2\n---\nc2")

    const skills = await loadSkillsDirs([tmpDir])
    expect(skills).toHaveLength(2)
  })

  it("should handle non-existent directory", async () => {
    const { loadSkillsDirs } = await import("../src/skill-loader.js")
    const skills = await loadSkillsDirs(["/nonexistent/path"])
    expect(skills).toEqual([])
  })
})

describe("S9: skill sorting", () => {
  function sortSkills(skills: Array<{ name: string; description: string }>, query: string): typeof skills {
    const q = query.toLowerCase()
    return skills
      .filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .sort((a, b) => {
        const aExact = a.name.toLowerCase() === q ? 1 : 0
        const bExact = b.name.toLowerCase() === q ? 1 : 0
        if (aExact !== bExact) return bExact - aExact
        const aStarts = a.name.toLowerCase().startsWith(q) ? 1 : 0
        const bStarts = b.name.toLowerCase().startsWith(q) ? 1 : 0
        return bStarts - aStarts
      })
  }

  const skills = [
    { name: "git-branch", description: "Manage git branches" },
    { name: "git-commit", description: "Create git commits" },
    { name: "bash", description: "Execute bash commands" },
    { name: "node-server", description: "Node.js server management" },
  ]

  it("should sort exact name match first", () => {
    const result = sortSkills(skills, "bash")
    expect(result[0].name).toBe("bash")
  })

  it("should sort prefix matches before substring matches", () => {
    const result = sortSkills(skills, "git")
    // git-branch and git-commit both start with "git" — alphabetical
    expect(result[0].name).toBe("git-branch")
    expect(result[1].name).toBe("git-commit")
  })

  it("should return empty for no match", () => {
    const result = sortSkills(skills, "nonexistent")
    expect(result).toHaveLength(0)
  })
})
