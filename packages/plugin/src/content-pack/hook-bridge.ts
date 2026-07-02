import { readFileSync } from "node:fs"
import { spawn } from "node:child_process"

export interface EccHookEntry {
  id: string
  description: string
  matcher: string
  type: "command"
  command: string
  async?: boolean
  timeout?: number
}

export interface EccHookManifest {
  hooks: {
    PreToolUse?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
    PostToolUse?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
    PostToolUseFailure?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
    Stop?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
    SessionStart?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
    SessionEnd?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
    PreCompact?: Array<{ matcher: string; hooks: Array<{ id?: string; description?: string; type: string; command: string; async?: boolean; timeout?: number }>; description?: string; id?: string }>
  }
}

export type DeepreefHookPhase = "beforeToolUse" | "afterToolUse" | "onGenerationComplete" | "onStartup" | "onShutdown"

export interface BridgedHook {
  id: string
  phase: DeepreefHookPhase
  toolMatcher: string
  command: string
  timeout?: number
}

const PHASE_MAP: Record<string, DeepreefHookPhase> = {
  PreToolUse: "beforeToolUse",
  PostToolUse: "afterToolUse",
  PostToolUseFailure: "afterToolUse",
  Stop: "onGenerationComplete",
  SessionStart: "onStartup",
  SessionEnd: "onShutdown",
}

export function parseEccHooks(filePath: string): { hooks: BridgedHook[]; warnings: string[] } {
  const warnings: string[] = []
  try {
    const raw = readFileSync(filePath, "utf8")
    const manifest = JSON.parse(raw) as EccHookManifest
    if (!manifest.hooks) {
      return { hooks: [], warnings: ["No hooks section found"] }
    }
    const bridged: BridgedHook[] = []
    for (const [eccPhase, entries] of Object.entries(manifest.hooks)) {
      const covaloPhase = PHASE_MAP[eccPhase]
      if (!covaloPhase) {
        warnings.push(`Unknown ECC hook phase "${eccPhase}", skipping`)
        continue
      }
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        const matcher = entry.matcher ?? "*"
        const entryId = entry.id // Hook ID is on the outer entry, not the inner hook
        const hooks = entry.hooks ?? []
        for (const hook of hooks) {
          if (hook.type !== "command") {
            warnings.push(`Non-command hook type "${hook.type}" not supported, skipping`)
            continue
          }
          if (!hook.command) continue
          // Use entry.id as primary ID, fall back to inner hook.id
          const hookId = entryId
            ? `ecc:${entryId}`
            : hook.id
              ? `ecc:${hook.id}`
              : `ecc:${matcher}:${hook.command.slice(0, 40)}`
          bridged.push({
            id: hookId,
            phase: covaloPhase,
            toolMatcher: matcher,
            command: hook.command,
            timeout: hook.timeout ?? 30,
          })
        }
      }
    }
    return { hooks: bridged, warnings }
  } catch (e) {
    return { hooks: [], warnings: [`Failed to parse ECC hooks: ${e instanceof Error ? e.message : String(e)}`] }
  }
}

export function executeEccHookCommand(command: string, timeout: number = 30): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeout * 1000,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: e.message }))
  })
}
