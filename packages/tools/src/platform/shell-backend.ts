import { spawn } from "node:child_process"
import { noopToolDiagnosticLogger, type ToolDiagnosticLogger } from "../diagnostics.js"

export type SupportedPlatform = "linux" | "darwin" | "win32"
export type ShellBackendId = "bash" | "pwsh" | "powershell"

export interface ShellBackend {
  id: ShellBackendId
  executable: string
  args: string[]
}

const cache = new Map<string, Promise<ShellBackend>>()
let logger: ToolDiagnosticLogger = noopToolDiagnosticLogger

export function setShellBackendLogger(next: ToolDiagnosticLogger): void {
  logger = next
}

export function clearShellBackendCache(): void {
  cache.clear()
}

export function defaultShellCandidates(platform: SupportedPlatform): ShellBackend[] {
  if (platform === "win32") {
    return [
      { id: "pwsh", executable: "pwsh.exe", args: ["-NoProfile", "-NonInteractive", "-Command"] },
      { id: "powershell", executable: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command"] },
    ]
  }
  return [{ id: "bash", executable: platform === "darwin" ? "/bin/bash" : "bash", args: ["-c"] }]
}

export async function resolveShellBackend(platform: SupportedPlatform): Promise<ShellBackend> {
  const override = process.env.COVALO_SHELL
  const overrideArgs = process.env.COVALO_SHELL_ARGS
  const cacheKey = `${platform}\0${override ?? ""}\0${overrideArgs ?? ""}`
  let pending = cache.get(cacheKey)
  if (!pending) {
    pending = detectShellBackend(platform, override, overrideArgs)
    cache.set(cacheKey, pending)
  }
  return pending
}

async function detectShellBackend(platform: SupportedPlatform, override?: string, overrideArgs?: string): Promise<ShellBackend> {
  if (override) {
    const args = overrideArgs ? JSON.parse(overrideArgs) as unknown : defaultArgs(platform, override)
    if (!Array.isArray(args) || !args.every(value => typeof value === "string")) {
      throw new Error("COVALO_SHELL_ARGS must be a JSON string array")
    }
    if (!await executableExists(override, platform)) {
      throw new Error(`Configured shell executable is not available: ${override}`)
    }
    return logSelection(platform, { id: inferShellId(override), executable: override, args }, true)
  }
  for (const candidate of defaultShellCandidates(platform)) {
    if (await executableExists(candidate.executable, platform)) return logSelection(platform, candidate, false)
  }
  throw new Error(`No supported shell executable found for ${platform}`)
}

function logSelection(platform: SupportedPlatform, backend: ShellBackend, override: boolean): ShellBackend {
  if (logger.isEnabled("debug")) {
    logger.debug("platform.shell.selected", { platform, backend: backend.id, executable: backend.executable, override })
  }
  return backend
}

function defaultArgs(platform: SupportedPlatform, executable: string): string[] {
  return platform === "win32" || /powershell|pwsh/i.test(executable)
    ? ["-NoProfile", "-NonInteractive", "-Command"]
    : ["-c"]
}

function inferShellId(executable: string): ShellBackendId {
  if (/pwsh/i.test(executable)) return "pwsh"
  if (/powershell/i.test(executable)) return "powershell"
  return "bash"
}

function executableExists(executable: string, platform: SupportedPlatform): Promise<boolean> {
  const checker = platform === "win32"
    ? { command: "where.exe", args: [executable] }
    : { command: "sh", args: ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", executable] }
  return new Promise(resolve => {
    const proc = spawn(checker.command, checker.args, { stdio: "ignore", timeout: 2_000 })
    proc.once("error", () => resolve(false))
    proc.once("close", code => resolve(code === 0))
  })
}
