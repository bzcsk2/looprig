import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("edit tool integration", () => {
  let tmpDir: string
  let filePath: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `deepicode-edit-int-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    filePath = join(tmpDir, "test.txt")
    writeFileSync(filePath, "original content\nsecond line\nthird line", "utf-8")
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("should edit file content", async () => {
    const { createEditTool } = await import("../src/edit.js")
    const tool = createEditTool()
    const r = await tool.execute({ path: filePath, old_string: "original content", new_string: "modified content" }, ctx)
    expect(r.isError).toBe(false)
    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"))
    expect(content).toContain("modified content")
  })

  it("should reject empty path", async () => {
    const { createEditTool } = await import("../src/edit.js")
    const tool = createEditTool()
    const r = await tool.execute({ path: "", old_string: "x", new_string: "y" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should return error when old_string not found", async () => {
    const { createEditTool } = await import("../src/edit.js")
    const tool = createEditTool()
    const r = await tool.execute({ path: filePath, old_string: "nonexistent text", new_string: "replacement" }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("not found")
  })

  it("should deny sensitive file paths", async () => {
    const { createEditTool } = await import("../src/edit.js")
    const tool = createEditTool()
    const r = await tool.execute({ path: join(tmpDir, "api-key"), old_string: "x", new_string: "y" }, ctx)
    expect(r.isError).toBe(true)
  })
})
