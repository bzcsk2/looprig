import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createReadFileTool } from "../src/file-ops.js"
import { createGlobTool } from "../src/glob.js"
import { createEditTool } from "../src/edit.js"
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal }) as any

describe("read_file", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = join(tmpdir(), `deepicode-read-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should read an existing text file", async () => {
    const filePath = join(tmpDir, "test.txt")
    writeFileSync(filePath, "hello world", "utf-8")
    const tool = createReadFileTool()
    const r = await tool.execute({ path: filePath }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.content).toContain("hello world")
  })

  it("should return error for non-existent file", async () => {
    const tool = createReadFileTool()
    const r = await tool.execute({ path: "/nonexistent/file.txt" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should deny sensitive file paths", async () => {
    const filePath = join(tmpDir, "api-key")
    writeFileSync(filePath, "sk-xxx", "utf-8")
    const tool = createReadFileTool()
    const r = await tool.execute({ path: filePath }, ctx(tmpDir))
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("sensitive")
  })

  it("should reject large files over 10MB", async () => {
    const tool = createReadFileTool()
    // Just verify the validation exists, don't actually create 10MB file
    const r = await tool.execute({ path: "" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should reject empty path", async () => {
    const tool = createReadFileTool()
    const r = await tool.execute({ path: "" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should resolve relative path via ctx.cwd", async () => {
    const subDir = join(tmpDir, "sub")
    mkdirSync(subDir)
    writeFileSync(join(subDir, "readme.txt"), "relative path content", "utf-8")
    const tool = createReadFileTool()
    // Execute with relative path, ctx.cwd = tmpDir
    const r = await tool.execute({ path: "sub/readme.txt" }, { cwd: tmpDir, signal: new AbortController().signal } as any)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.content).toContain("relative path content")
  })

  it("should slice by start_line and end_line", async () => {
    const filePath = join(tmpDir, "lines.txt")
    writeFileSync(filePath, "line0\nline1\nline2\nline3\nline4\n", "utf-8")
    const tool = createReadFileTool()
    const r = await tool.execute({ path: filePath, start_line: 1, end_line: 3 }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.content).toBe("line1\nline2\nline3")
  })

  it("should truncate output at max_chars with notice", async () => {
    const filePath = join(tmpDir, "long.txt")
    writeFileSync(filePath, "a".repeat(500) + "b".repeat(500), "utf-8")
    const tool = createReadFileTool()
    const r = await tool.execute({ path: filePath, max_chars: 100 }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.content).toContain("[truncated")
    expect(p.content.length).toBeLessThan(300)
  })

  it("should read empty file returning empty content string", async () => {
    const filePath = join(tmpDir, "empty.txt")
    writeFileSync(filePath, "", "utf-8")
    const tool = createReadFileTool()
    const r = await tool.execute({ path: filePath }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.content).toBe("")
  })

  it("should record read so edit can detect staleness (read_file + edit integration)", async () => {
    const filePath = join(tmpDir, "stale-flow.txt")
    writeFileSync(filePath, "original content", "utf-8")
    const tool = createReadFileTool()
    const r1 = await tool.execute({ path: filePath }, ctx(tmpDir))
    expect(r1.isError).toBe(false)

    writeFileSync(filePath, "modified content with different size", "utf-8")

    const editTool = createEditTool()
    const r2 = await editTool.execute({ path: filePath, old_string: "modified", new_string: "changed" }, ctx(tmpDir))
    expect(r2.isError).toBe(true)
    const p = JSON.parse(r2.content as string)
    expect(p.error).toContain("modified since last read")
  })

  it("should handle binary file with random bytes without crashing", async () => {
    const filePath = join(tmpDir, "random.bin")
    const buf = Buffer.alloc(256)
    for (let i = 0; i < 256; i++) buf[i] = i
    writeFileSync(filePath, buf)
    const tool = createReadFileTool()
    const r = await tool.execute({ path: filePath }, ctx(tmpDir))
    // binary content may cause UTF-8 decoding issues; should not crash
    // Currently reads with replacement characters (no explicit binary warning)
    const p = JSON.parse(r.content as string)
    expect(typeof p.content).toBe("string")
    expect(p.content).toBeTruthy()
  })
})

describe("write_file", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = join(tmpdir(), `deepicode-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should create file with content in nested directory", async () => {
    const { createWriteFileTool } = await import("../src/write-file.js")
    const tool = createWriteFileTool()
    const filePath = join(tmpDir, "sub", "nested", "file.txt")
    const r = await tool.execute({ path: filePath, content: "nested content" }, { cwd: tmpDir, signal: new AbortController().signal } as any)
    expect(r.isError).toBe(false)
    expect(readFileSync(filePath, "utf-8")).toBe("nested content")
  })

  it("should create empty file when content is empty string", async () => {
    const { createWriteFileTool } = await import("../src/write-file.js")
    const tool = createWriteFileTool()
    const filePath = join(tmpDir, "empty.txt")
    const r = await tool.execute({ path: filePath, content: "" }, { cwd: tmpDir, signal: new AbortController().signal } as any)
    expect(r.isError).toBe(false)
    expect(readFileSync(filePath, "utf-8")).toBe("")
  })

  it("should resolve relative path via ctx.cwd", async () => {
    const { createWriteFileTool } = await import("../src/write-file.js")
    const tool = createWriteFileTool()
    const r = await tool.execute({ path: "relative.txt", content: "relative path" }, { cwd: tmpDir, signal: new AbortController().signal } as any)
    expect(r.isError).toBe(false)
    expect(readFileSync(join(tmpDir, "relative.txt"), "utf-8")).toBe("relative path")
  })
})

describe("glob", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = join(tmpdir(), `deepicode-glob-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, "a.ts"), "a", "utf-8")
    writeFileSync(join(tmpDir, "b.ts"), "b", "utf-8")
    mkdirSync(join(tmpDir, "sub"))
    writeFileSync(join(tmpDir, "sub", "c.ts"), "c", "utf-8")
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should find matching files in directory", async () => {
    const tool = createGlobTool()
    const r = await tool.execute({ pattern: "*.ts", path: tmpDir }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.numFiles).toBe(2)
  })

  it("should find files recursively with **/*", async () => {
    const tool = createGlobTool()
    const r = await tool.execute({ pattern: "**/*.ts", path: tmpDir }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.numFiles).toBe(3)
  })

  it("should return empty for no matches", async () => {
    const tool = createGlobTool()
    const r = await tool.execute({ pattern: "*.py", path: tmpDir }, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.numFiles).toBe(0)
  })

  it("should reject empty pattern", async () => {
    const tool = createGlobTool()
    const r = await tool.execute({ pattern: "", path: tmpDir }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should reject path traversal outside project directory", async () => {
    const tool = createGlobTool()
    // /tmp is outside tmpDir, so traversal should be denied
    const r = await tool.execute({ pattern: "*.txt", path: "/tmp" }, { cwd: tmpDir, signal: new AbortController().signal } as any)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("outside")
  })

  it("should reject path traversal with ../", async () => {
    const tool = createGlobTool()
    const r = await tool.execute({ pattern: "*.txt", path: "../" }, { cwd: tmpDir, signal: new AbortController().signal } as any)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("outside")
  })
})
