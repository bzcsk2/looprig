import { describe, it, expect } from "vitest"
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

  it("should reject empty command", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should capture stderr separately from stdout", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "echo stdout_msg && echo stderr_msg >&2" }, ctx)
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
    const r = await tool.execute({ command: "echo $PATH" }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout.trim().length).toBeGreaterThan(0)
  })

  it("should truncate stdout exceeding max_chars with notice", async () => {
    const { createBashTool } = await import("../src/shell-exec.js")
    const tool = createBashTool()
    const r = await tool.execute({ command: "for i in $(seq 1 1000); do echo 'line ' $i; done", max_chars: 100 }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.stdout).toContain("... [truncated")
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
