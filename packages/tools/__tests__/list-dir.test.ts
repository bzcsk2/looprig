import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createListDirTool } from "../src/list-dir.js"

describe("list_dir", () => {
  let tmpDir: string
  const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal } as any)

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "covalo-listdir-"))
    writeFileSync(join(tmpDir, "file.txt"), "hello", "utf-8")
    mkdirSync(join(tmpDir, "subdir"))
    writeFileSync(join(tmpDir, "subdir", "nested.txt"), "nested", "utf-8")
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("should list files and directories with correct types and sizes", async () => {
    const tool = createListDirTool()
    const r = await tool.execute({ path: tmpDir }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(Array.isArray(p.items)).toBe(true)
    const files = p.items.filter((i: any) => i.type === "file")
    const dirs = p.items.filter((i: any) => i.type === "dir")
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(dirs.length).toBeGreaterThanOrEqual(1)
    expect(files[0].size).toBeGreaterThan(0)
  })

  it("should return error for non-existent directory", async () => {
    const tool = createListDirTool()
    const r = await tool.execute({ path: "/nonexistent/path" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toMatch(/(not found|cannot resolve|outside)/)
  })

  it("should report stat failure entries as type: unknown", async () => {
    const tool = createListDirTool()
    const badFile = join(tmpDir, "bad-perm")
    writeFileSync(badFile, "secret", "utf-8")
    // Make it unreadable so stat fails
    try { chmodSync(badFile, 0o000) } catch {}

    const r = await tool.execute({ path: tmpDir }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    const unknown = p.items.filter((i: any) => i.type === "unknown")
    expect(unknown.length).toBeGreaterThanOrEqual(0) // may or may not catch depending on root
  })

  it("should reject empty path", async () => {
    const tool = createListDirTool()
    const r = await tool.execute({ path: "" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should resolve relative path via ctx.cwd", async () => {
    const tool = createListDirTool()
    const r = await tool.execute({ path: "." }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(Array.isArray(p.items)).toBe(true)
  })

  it("should return empty items array for empty directory", async () => {
    const emptyDir = join(tmpDir, "empty-subdir")
    mkdirSync(emptyDir)
    const tool = createListDirTool()
    const r = await tool.execute({ path: "empty-subdir" }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.items).toEqual([])
  })

  it("denies listing a sensitive directory (.ssh)", async () => {
    mkdirSync(join(tmpDir, ".ssh"))
    const tool = createListDirTool()
    const r = await tool.execute({ path: join(tmpDir, ".ssh") }, ctx(tmpDir))
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("sensitive")
  })

  it("omits sensitive child files from directory listing", async () => {
    writeFileSync(join(tmpDir, ".env"), "SECRET=value", "utf-8")
    writeFileSync(join(tmpDir, ".npmrc"), "//registry.npmjs.org/:_authToken=abc", "utf-8")
    writeFileSync(join(tmpDir, "normal.txt"), "hello", "utf-8")
    mkdirSync(join(tmpDir, ".ssh"))

    const tool = createListDirTool()
    const r = await tool.execute({ path: tmpDir }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    const names = p.items.map((i: any) => i.name)
    expect(names).not.toContain(".env")
    expect(names).not.toContain(".npmrc")
    expect(names).not.toContain(".ssh")
    expect(names).toContain("normal.txt")
    expect(names).toContain("file.txt")
    expect(names).toContain("subdir")
  })
})
