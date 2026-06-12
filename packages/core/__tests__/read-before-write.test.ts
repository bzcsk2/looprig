import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ReadTracker, extractFilePath, isWriteTool, isReadTool } from "../src/read-before-write.js"

describe("ReadTracker", () => {
  let cwd: string
  let tracker: ReadTracker

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "rbw-test-"))
    tracker = new ReadTracker()
    writeFileSync(join(cwd, "existing.txt"), "hello")
  })

  it("should allow write to new file without prior read", () => {
    const result = tracker.checkWrite("new.txt", cwd)
    expect(result.ok).toBe(true)
  })

  it("should warn on first write to unread existing file", () => {
    const result = tracker.checkWrite("existing.txt", cwd)
    expect(result.ok).toBe(false)
    expect(result.warning).toBe(true)
    expect(result.reason).toContain("haven't read")
  })

  it("should allow second write attempt after warning", () => {
    tracker.checkWrite("existing.txt", cwd)
    const result = tracker.checkWrite("existing.txt", cwd)
    expect(result.ok).toBe(true)
  })

  it("should allow write after read", () => {
    tracker.recordRead("existing.txt", cwd)
    const result = tracker.checkWrite("existing.txt", cwd)
    expect(result.ok).toBe(true)
  })

  it("should block in strict mode", () => {
    const strict = new ReadTracker({ strict: true })
    const result = strict.checkWrite("existing.txt", cwd)
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
  })

  it("should reset tracking", () => {
    tracker.recordRead("existing.txt", cwd)
    tracker.reset()
    const result = tracker.checkWrite("existing.txt", cwd)
    expect(result.ok).toBe(false)
  })
})

describe("tool helpers", () => {
  it("should extract file path from tool args", () => {
    expect(extractFilePath("write_file", { path: "/foo/bar" })).toBe("/foo/bar")
    expect(extractFilePath("read_file", { path: "src/index.ts" })).toBe("src/index.ts")
  })

  it("should classify write and read tools", () => {
    expect(isWriteTool("write_file")).toBe(true)
    expect(isWriteTool("edit")).toBe(true)
    expect(isReadTool("read_file")).toBe(true)
    expect(isWriteTool("bash")).toBe(false)
  })
})
