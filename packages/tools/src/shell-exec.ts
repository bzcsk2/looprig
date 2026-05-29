import { spawn } from "node:child_process"
import type { AgentTool } from "../../core/src/interface.js"

export function createBashTool(): AgentTool {
  return {
    name: "bash",
    description: "Run a shell command (bash). Returns stdout+stderr (truncated).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        cwd: { type: "string", description: "Working directory (optional)." },
        timeout_ms: { type: "number", description: "Timeout in milliseconds." },
        max_chars: { type: "number", description: "Max chars for combined output." },
      },
      required: ["command"],
    },
    concurrency: "exclusive",
    approval: "exec",
    async execute(args, ctx) {
      const command = String(args.command)
      const cwd = typeof args.cwd === "string" ? args.cwd : ctx.cwd
      const timeoutMs = typeof args.timeout_ms === "number" ? Math.max(0, Math.floor(args.timeout_ms)) : 30_000
      const maxChars = typeof args.max_chars === "number" ? Math.max(0, Math.floor(args.max_chars)) : 200_000

      const out = await runBash(command, cwd, timeoutMs, maxChars, ctx.signal)
      return { content: JSON.stringify(out), isError: out.exitCode !== 0, metadata: { exitCode: out.exitCode } }
    },
  }
}

async function runBash(command: string, cwd: string, timeoutMs: number, maxChars: number, signal?: AbortSignal): Promise<{
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let done = false

    const finish = (exitCode: number) => {
      if (done) return
      done = true
      resolve({
        command,
        cwd,
        stdout: truncate(stdout, maxChars),
        stderr: truncate(stderr, maxChars),
        exitCode,
        timedOut,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
      finish(124)
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        child.kill("SIGKILL")
        finish(130)
        return
      }
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        child.kill("SIGKILL")
        finish(130)
      }, { once: true })
    }

    child.stdout.on("data", (b) => { stdout += String(b) })
    child.stderr.on("data", (b) => { stderr += String(b) })
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      finish(code ?? 0)
    })
  })
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max)
}

