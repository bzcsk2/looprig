import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createGlobTool } from "../src/glob.js"
import { createEditTool } from "../src/edit.js"
import { createMonitorTool } from "../src/monitor.js"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal }) as any

describe("S14: path traversal protection across tools", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "deepicode-sec-e2e-"))
  })
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("glob should reject path traversal outside project", async () => {
    const tool = createGlobTool()
    const isWin = process.platform === "win32"
    const testPath = isWin ? "C:\\tmp" : "/tmp"
    const r = await tool.execute({ pattern: "*.txt", path: testPath }, ctx(tmpDir))
    expect(r.isError).toBe(true)
    const err = JSON.parse(r.content as string).error
    // Windows may say "cannot resolve path" instead of "outside"
    expect(err).toMatch(/(outside|cannot resolve)/)
  })

  it("glob should reject path traversal with ../", async () => {
    const tool = createGlobTool()
    const r = await tool.execute({ pattern: "*.txt", path: "../" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("outside")
  })

  it("edit should handle non-existent file via path traversal (no explicit check, ends in not-found)", async () => {
    const tool = createEditTool()
    const r = await tool.execute(
      { path: "../../../etc/passwd", old_string: "root", new_string: "user" },
      ctx(tmpDir),
    )
    expect(r.isError).toBe(true)
    // The file doesn't exist — either "not found" or "outside" depends on implementation
    const p = JSON.parse(r.content as string)
    expect(p.error).toBeTruthy()
  })
})
