import { spawn } from "node:child_process"
import { resolve } from "node:path"
import type { AgentTool, ToolProgressUpdate } from "@deepicode/core"
import { safeStringify, hasBinaryEncoding } from "./safe-stringify.js"
import { isSensitive } from "./sensitive.js"
import { normalizePlatform } from "./platform/capabilities.js"
import { terminateProcessTree } from "./platform/process-tree.js"
import { resolveShellBackend, type ShellBackendId } from "./platform/shell-backend.js"

const POSIX_DENY_PATTERNS = [
  /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*\s+.*\/\*|.*-[A-Za-z]*r[A-Za-z]*\s+\/)/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-R\s+777\s+\//,
  /\bdd\b/,
  /\bfdisk\b/,
  /\bmkfs\.\w+\b/,
  /\bgit\s+push\b/,
  /\bgit\s+commit\b/,
]

const POWERSHELL_DENY_PATTERNS = [
  /\b(?:Remove-Item|rm)\b[^;\n]*(?:-Recurse\b[^;\n]*)?(?:[A-Za-z]:\\|\/)\s*(?:-\w+\s*)*$/i,
  /\b(?:Remove-Item|rm)\b[^;\n]*-[FRS]\b/i,
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bInitialize-Disk\b/i,
  /\bStart-Process\b[^;\n]*-Verb\s+RunAs\b/i,
]

function isDenied(command: string, backend: ShellBackendId): string | null {
  const patterns = backend === "bash" ? POSIX_DENY_PATTERNS : POWERSHELL_DENY_PATTERNS
  for (const p of patterns) {
    if (p.test(command.trim())) return p.source
  }
  return null
}

export function createBashTool(): AgentTool {
  return {
    name: "bash",
    description: "Run a command using the current platform shell. The historical tool name remains bash for compatibility. Returns stdout+stderr (truncated).",
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
      if (typeof args.command !== "string" || !args.command.trim()) {
        return { content: safeStringify({ error: "command is required" }), isError: true }
      }
      const command = args.command.trim()
      let backend
      try {
        backend = await resolveShellBackend(normalizePlatform())
      } catch (error) {
        return { content: safeStringify({ error: error instanceof Error ? error.message : String(error) }), isError: true }
      }
      const denied = isDenied(command, backend.id)
      if (denied) {
        return { content: safeStringify({ error: `Command denied: matches dangerous pattern /${denied}/` }), isError: true }
      }
      const pathRe = /\b([\w./-]*(?:\.\w{1,10}))\b|\b([\w./-]*\/?\.[\w.-]+)\b|\b([\w./-]*(?:id_rsa|id_ed25519|credentials\.json|service-account\.json|token\.json))\b/g
      let pathMatch: RegExpExecArray | null
      while ((pathMatch = pathRe.exec(command)) !== null) {
        const fp = pathMatch[1] || pathMatch[2] || pathMatch[3]
        if (fp && isSensitive(fp)) {
          return { content: safeStringify({ error: `Command references sensitive file: ${fp}` }), isError: true }
        }
      }
      const cwd = typeof args.cwd === "string" ? resolve(ctx.cwd, args.cwd) : ctx.cwd
      const timeoutMs = typeof args.timeout_ms === "number" ? Math.max(0, Math.floor(args.timeout_ms)) : 30_000
      const maxChars = typeof args.max_chars === "number" ? Math.max(0, Math.floor(args.max_chars)) : 200_000

      const out = await runShell(command, cwd, timeoutMs, maxChars, ctx.signal, ctx.reportProgress, backend)
      if (hasBinaryEncoding(out.stdout) || hasBinaryEncoding(out.stderr)) {
        ;(out as any).encoding_warning = "output contains non-UTF-8 binary data"
      }
      return { content: safeStringify(out), isError: out.exitCode !== 0, metadata: { exitCode: out.exitCode } }
    },
  }
}

interface BoundedBuffer {
  text: string
  max: number
  dropped: number
}

function pushBounded(buf: BoundedBuffer, chunk: string): void {
  buf.text += chunk
  if (buf.text.length > buf.max * 2) {
    const excess = buf.text.length - buf.max
    buf.text = buf.text.slice(excess)
    buf.dropped += excess
  }
}

function finalizeBounded(buf: BoundedBuffer): { text: string; dropped: number } {
  if (buf.dropped > 0) {
    return {
      text: buf.text.slice(-buf.max) + `\n... [dropped ${buf.dropped} earlier chars]`,
      dropped: buf.dropped,
    }
  }
  if (buf.text.length > buf.max) {
    return {
      text: buf.text.slice(-buf.max) + `\n... [truncated: ${buf.text.length - buf.max} more chars]`,
      dropped: buf.text.length - buf.max,
    }
  }
  return { text: buf.text, dropped: 0 }
}

// Rate-limiter: only emit progress if content changed significantly or 200ms elapsed
function createProgressThrottle(report?: (update: ToolProgressUpdate) => void): (update: ToolProgressUpdate) => void {
  if (!report) return () => {}
  let lastContent = ""
  let lastTs = 0
  const MIN_INTERVAL = 200
  return (update) => {
    const now = Date.now()
    // Always emit if content changed and enough time elapsed
    if (update.content !== lastContent && now - lastTs >= MIN_INTERVAL) {
      lastContent = update.content
      lastTs = now
      report(update)
    }
  }
}

async function runShell(command: string, cwd: string, timeoutMs: number, maxChars: number, signal: AbortSignal | undefined, reportProgress: ((update: ToolProgressUpdate) => void) | undefined, backend: { id: ShellBackendId; executable: string; args: string[] }): Promise<{
  backend: ShellBackendId
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}> {
  return await new Promise((resolve, reject) => {
    const platform = normalizePlatform()
    const child = spawn(backend.executable, [...backend.args, command], {
      cwd, detached: platform !== "win32",
      env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", EDITOR: "true" },
    })

    const stdoutBuf: BoundedBuffer = { text: "", max: maxChars, dropped: 0 }
    const stderrBuf: BoundedBuffer = { text: "", max: maxChars, dropped: 0 }
    let timedOut = false
    let done = false
    let sigtermTimer: ReturnType<typeof setTimeout> | null = null

    const report = createProgressThrottle(reportProgress)

    const killChild = (graceful = false) => {
      terminateProcessTree(child, !graceful, platform)
      if (graceful) {
        sigtermTimer = setTimeout(() => {
          terminateProcessTree(child, true, platform)
        }, 5000)
      }
    }

    const cleanup = () => {
      if (sigtermTimer) {
        clearTimeout(sigtermTimer)
        sigtermTimer = null
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort)
      }
    }

    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      killChild()
      finish(130)
    }

    const finish = (exitCode: number) => {
      if (done) return
      done = true
      cleanup()
      const stdoutFinal = finalizeBounded(stdoutBuf)
      const stderrFinal = finalizeBounded(stderrBuf)
      resolve({
        backend: backend.id,
        command,
        cwd,
        stdout: stdoutFinal.text,
        stderr: stderrFinal.text,
        exitCode,
        timedOut,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      killChild(true)
      finish(124)
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        cleanup()
        killChild()
        finish(130)
        return
      }
      signal.addEventListener("abort", onAbort, { once: true })
    }

    child.stdout.on("data", (b) => {
      const chunk = String(b)
      pushBounded(stdoutBuf, chunk)
      report({ content: `stdout: ${chunk.slice(-200)}` })
    })
    child.stderr.on("data", (b) => {
      const chunk = String(b)
      pushBounded(stderrBuf, chunk)
      report({ content: `stderr: ${chunk.slice(-200)}` })
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      cleanup()
      reject(e) // spawn error — reject, not resolve
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      finish(code ?? 0)
    })
  })
}
