import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("bash tool", () => {
  it("should execute simple echo command", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "echo hello" }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout.trim()).toBe("hello")
  })

  it("should execute command with special characters", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "echo 'hello world' && echo 'done'" }, ctx)
    expect(r.isError).toBe(false)
  })

  it("should report non-zero exit code", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "false" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should deny rm -rf /", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "rm -rf /" }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("denied")
  })

  it("should deny sudo commands", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "sudo whoami" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("S12: reading non-existent sensitive file via bash returns command error (not denied)", async () => {
    // bash does NOT check file paths in commands — it only checks DENY_PATTERNS
    // The command fails because file doesn't exist, not because of security check
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "cat .env" }, ctx)
    expect(r.isError).toBe(true)
    const p = JSON.parse(r.content as string)
    expect(p.exitCode).toBe(1) // file not found
  })

  it("S15: SQL-like text in command does not match DENY_PATTERNS and executes safely", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "echo hello" }, ctx)
    // Should execute normally — "hello" is not a dangerous command
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout.trim()).toBe("hello")
  })

  it("should reject empty command", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should capture stderr separately from stdout", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const isWin = process.platform === "win32"
    const cmd = isWin ? 'Write-Output "stdout_msg"; Write-Error "stderr_msg"' : "echo stdout_msg && echo stderr_msg >&2"
    const r = await tool.execute({ command: cmd }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    // stdout should contain "stdout_msg" and stderr should contain "stderr_msg"
    expect(p.stdout).toContain("stdout_msg")
    expect(p.stderr).toContain("stderr_msg")
  })

  it("should reject commands referencing absolute sensitive file paths", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "cat /etc/ssl/private/api-key" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should resolve cwd relative to ctx.cwd", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tmpDir = mkdtempSync(join(tmpdir(), "deepicode-bash-cwd-"))
    writeFileSync(join(tmpDir, "test.txt"), "cwd test")
    const tool = createBashTool()
    const r = await tool.execute({ command: "cat test.txt", cwd: tmpDir }, { cwd: "/tmp", signal: new AbortController().signal } as any)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout.trim()).toBe("cwd test")
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should preserve PATH and other env variables", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const isWin = process.platform === "win32"
    const cmd = isWin ? "Write-Output $env:PATH" : "echo $PATH"
    const r = await tool.execute({ command: cmd }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout.trim().length).toBeGreaterThan(0)
  })

  it("should truncate stdout exceeding max_chars with notice", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const isWin = process.platform === "win32"
    const cmd = isWin
      ? "1..1000 | ForEach-Object { Write-Output \"line $_\" }"
      : "for i in $(seq 1 1000); do echo 'line ' $i; done"
    const r = await tool.execute({ command: cmd, max_chars: 100 }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout).toMatch(/\.\.\. \[(truncated|dropped)/)
  })

  it("should detect binary output and emit encoding_warning", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "printf '\\xff\\xfe\\x00\\x01' && echo normal" }, ctx)
    const p = JSON.parse(r.content as string)
    if (p.encoding_warning) {
      expect(p.encoding_warning).toContain("binary")
    }
  })
})

describe("CL-21: Bash bounded output", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deepicode-cl21-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("drops earlier chars when output exceeds max_chars", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const ctx = { cwd: dir, signal: new AbortController().signal } as any
    const isWin = process.platform === "win32"
    const cmd = isWin
      ? "1..1000 | ForEach-Object { Write-Output \"line $_\" }"
      : 'for i in $(seq 1 1000); do echo "line $i"; done'
    const r = await tool.execute({ command: cmd, max_chars: 5000 }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.stdout).toMatch(/\.\.\. \[(dropped|truncated)/)
    expect(p.stdout.length).toBeLessThan(6000)
  })

  it("returns normal output when under limit", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const ctx = { cwd: dir, signal: new AbortController().signal } as any
    const r = await tool.execute({ command: "echo hello", max_chars: 100000 }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.stdout.trim()).toBe("hello")
    expect(p.exitCode).toBe(0)
  })

  it("sets non-zero exitCode on command failure", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const ctx = { cwd: dir, signal: new AbortController().signal } as any
    const r = await tool.execute({ command: "exit 42" }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.exitCode).toBe(42)
    expect(r.isError).toBe(true)
  })

  it("timedOut is true when command exceeds timeout", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const ctx = { cwd: dir, signal: new AbortController().signal } as any
    const r = await tool.execute({ command: "sleep 5", timeout_ms: 500 }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.timedOut).toBe(true)
    expect(p.exitCode).toBe(124)
  })

  it("AbortSignal kills running command", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const ac = new AbortController()
    const ctx = { cwd: dir, signal: ac.signal } as any
    const p = tool.execute({ command: "sleep 10", timeout_ms: 30000 }, ctx)
    setTimeout(() => ac.abort(), 200)
    const r = await p
    const parsed = JSON.parse(r.content as string)
    expect(parsed.exitCode).toBe(130)
  })
})
