import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawn } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { startScriptedSseServer } from "./helpers/scripted-sse-server.js"

const REPO_ROOT = join(import.meta.dirname, "../..")
const CLI_ENTRY = join(REPO_ROOT, "packages/cli/src/index.ts")

describe("LIFE-01: CLI pipe mode lifecycle", () => {
  let tmpDir: string
  let sse: Awaited<ReturnType<typeof startScriptedSseServer>>

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `covalo-pipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tmpDir, { recursive: true })
    sse = await startScriptedSseServer({ responses: ["hello", " world", "done"] })
  })

  afterEach(async () => {
    await sse.stop()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("process exits naturally within 5 seconds with code 0", async () => {
    const logPath = join(tmpDir, "runtime.jsonl")
    const env = {
      ...process.env,
      COVALO_PROVIDER: "deepseek",
      DEEPSEEK_BASE_URL: sse.url,
      DEEPSEEK_API_KEY: "test-key-must-not-appear",
      HOME: tmpDir,
      COVALO_LOG_LEVEL: "debug",
      COVALO_LOG_FILE: logPath,
    }

    const proc = spawn("bun", [CLI_ENTRY], {
      cwd: REPO_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    // Send input and close stdin
    proc.stdin.write("hi\n")
    proc.stdin.end()

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

    const exitCode = await new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL")
        resolve(null)
      }, 5000)
      proc.on("exit", (code) => {
        clearTimeout(timeout)
        resolve(code)
      })
    })

    const output = Buffer.concat(stdout).toString("utf8")
    const errOutput = Buffer.concat(stderr).toString("utf8")

    // Debug: print stderr and log on failure so we can diagnose hangs
    if (exitCode !== 0) {
      const { readFile } = await import("node:fs/promises")
      const log = await readFile(logPath, "utf-8").catch(() => "(no log)")
      // eslint-disable-next-line no-console
      console.error("--- STDERR ---\n", errOutput, "\n--- STDOUT ---\n", output, "\n--- LOG ---\n", log)
    }

    expect(exitCode).toBe(0)
    expect(output).toContain("hello worlddone")
    expect(errOutput).not.toContain("test-key-must-not-appear")
  })
})
