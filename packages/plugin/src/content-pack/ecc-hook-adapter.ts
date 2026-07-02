import type { HookManager, ToolCallHooks, BeforeToolCallContext, ToolCallResult } from "@covalo/security"
import type { BridgedHook } from "./hook-bridge.js"
import { parseEccHooks } from "./hook-bridge.js"
import type { ResolvedContentPack, ContentPackDiagnostic } from "./types.js"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

export interface EccHookAdapterOptions {
  hookManager: HookManager
  hookTimeoutMs?: number
  stdoutMaxLen?: number
  stderrMaxLen?: number
  diagnosticCallback?: (diag: ContentPackDiagnostic) => void
}

// ECC tool name -> Deepreef tool name mapping for matchers
const TOOL_NAME_MAP: Record<string, string> = {
  Read: "read_file",
  Write: "write_file",
  Edit: "edit",
  MultiEdit: "edit",
  Bash: "bash",
  Grep: "grep",
  Glob: "glob",
  TodoWrite: "todo_write",
  ListDir: "list_dir",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  Skill: "Skill",
  Task: "task_create",
  AskUser: "ask_user_question",
  Notebook: "notebook_edit",
  Sleep: "sleep",
}

const TIMEOUT_DEFAULT = 30_000
const STDOUT_MAX_DEFAULT = 10_000
const STDERR_MAX_DEFAULT = 10_000

function eccToDeepreefToolName(eccName: string): string {
  return TOOL_NAME_MAP[eccName] ?? eccName
}

/**
 * Check if a tool name matches an ECC matcher pattern.
 * ECC uses compound matchers like "Edit|Write" or single names like "Bash".
 */
function matchToolMatcher(matcher: string, toolName: string): boolean {
  if (!matcher || matcher === "*") return true
  const parts = matcher.split("|").map(p => p.trim())
  const covaloName = eccToDeepreefToolName(toolName)
  return parts.some(part => {
    return part === toolName || part === covaloName || eccToDeepreefToolName(part) === toolName || eccToDeepreefToolName(part) === covaloName
  })
}

// Keep track of which lifecycle hooks have already been triggered
// to prevent loop hooks from firing on every event
const executedLifecyclePhases = new Map<ResolvedContentPack, Set<string>>()

/**
 * Create a ToolCallHooks adapter that bridges ECC command hooks
 * into the Deepreef HookManager lifecycle.
 *
 * Security: ECC hooks are recognized but NOT executed by default.
 * Execution requires:
 *   1. hooks.enabled === true
 *   2. hooks.allowCommandHooks === true
 *   3. Hook ID is in the allowlist (must be explicitly configured)
 */
export function createEccHookAdapter(
  cp: ResolvedContentPack,
  workspaceRoot: string,
  options: EccHookAdapterOptions,
): ToolCallHooks | null {
  const hookAssets = cp.assets.hooks
  if (hookAssets.length === 0) return null

  const hookOptions = cp.options.hooks ?? {}
  if (hookOptions.enabled !== true) {
    options.diagnosticCallback?.({
      type: "info",
      pluginId: cp.id,
      message: `ECC hooks recognized but not executed (disabled by config)`,
    })
    return null
  }

  // Must explicitly allow command hooks
  if (hookOptions.allowCommandHooks !== true) {
    options.diagnosticCallback?.({
      type: "info",
      pluginId: cp.id,
      message: `ECC hooks recognized but not executed (allowCommandHooks not enabled)`,
    })
    return null
  }

  // Parse all hook files
  const allBridged: BridgedHook[] = []
  const warnings: string[] = []

  for (const asset of hookAssets) {
    const result = parseEccHooks(asset.path)
    allBridged.push(...result.hooks)
    warnings.push(...result.warnings)
  }

  if (allBridged.length === 0) {
    for (const w of warnings) {
      options.diagnosticCallback?.({ type: "warn", pluginId: cp.id, message: w })
    }
    return null
  }

  // Allowlist must be explicitly configured (default deny-all for security)
  const allowlist = hookOptions.allowlist
  if (!allowlist || allowlist.length === 0) {
    options.diagnosticCallback?.({
      type: "warn",
      pluginId: cp.id,
      message: `No hook allowlist configured; all ${allBridged.length} hooks blocked by default`,
    })
    return null
  }

  // Filter by allowlist using hook ID (from manifest hook.id)
  const bridged = allBridged.filter(h => allowlist.includes(h.id) || allowlist.includes("*"))
  const denied = allBridged.filter(h => !allowlist.includes(h.id) && !allowlist.includes("*"))
  for (const d of denied) {
    options.diagnosticCallback?.({
      type: "info",
      pluginId: cp.id,
      message: `ECC hook "${d.id}" not in allowlist, skipped`,
    })
  }

  if (bridged.length === 0) {
    options.diagnosticCallback?.({
      type: "warn",
      pluginId: cp.id,
      message: `No ECC hooks passed allowlist filtering`,
    })
    return null
  }

  // Create the adapter
  const timeoutMs = options.hookTimeoutMs ?? TIMEOUT_DEFAULT
  const stdoutMax = options.stdoutMaxLen ?? STDOUT_MAX_DEFAULT
  const stderrMax = options.stderrMaxLen ?? STDERR_MAX_DEFAULT

  const adapter: ToolCallHooks = {}

  // --- beforeToolCall ---
  const beforeHooks = bridged.filter(h => h.phase === "beforeToolUse")
  if (beforeHooks.length > 0) {
    adapter.beforeToolCall = async (context: BeforeToolCallContext) => {
      const matchedHooks = beforeHooks.filter(h => matchToolMatcher(h.toolMatcher, context.toolName))

      for (const hook of matchedHooks) {
        try {
          const result = await executeHookCommandSafe(
            hook.command,
            workspaceRoot,
            cp.rootDir,
            timeoutMs,
            stdoutMax,
            stderrMax,
          )
          if (result.error) {
            options.diagnosticCallback?.({
              type: "error",
              pluginId: cp.id,
              message: `Before hook "${hook.id}" failed: ${result.error}`,
            })
            return "deny" // fail-safe: deny on hook failure
          }
        } catch (e) {
          options.diagnosticCallback?.({
            type: "error",
            pluginId: cp.id,
            message: `Before hook "${hook.id}" threw: ${e instanceof Error ? e.message : String(e)}`,
          })
          return "deny" // fail-safe: deny on exception
        }
      }
      return // no opinion
    }
  }

  // --- afterToolCall ---
  const afterHooks = bridged.filter(h => h.phase === "afterToolUse")
  if (afterHooks.length > 0) {
    adapter.afterToolCall = async (toolName: string, result: ToolCallResult) => {
      const matchedHooks = afterHooks.filter(h => matchToolMatcher(h.toolMatcher, toolName))

      for (const hook of matchedHooks) {
        try {
          await executeHookCommandSafe(
            hook.command,
            workspaceRoot,
            cp.rootDir,
            timeoutMs,
            stdoutMax,
            stderrMax,
          )
        } catch {
          // after hooks must not break the flow
        }
      }
    }
  }

  // --- onLoopEvent ---
  // Lifecycle hooks dispatch by event type, not all-at-once.
  // Event type mapping:
  //   "startup" → onStartup phase
  //   "shutdown" → onShutdown phase
  //   "generation_complete" / "stop" → onGenerationComplete phase
  const lifecycleByPhase = new Map<string, BridgedHook[]>()
  for (const h of bridged) {
    if (h.phase === "onStartup" || h.phase === "onShutdown" || h.phase === "onGenerationComplete") {
      const list = lifecycleByPhase.get(h.phase) ?? []
      list.push(h)
      lifecycleByPhase.set(h.phase, list)
    }
  }

  if (lifecycleByPhase.size > 0) {
    if (!executedLifecyclePhases.has(cp)) {
      executedLifecyclePhases.set(cp, new Set())
    }
    const executed = executedLifecyclePhases.get(cp)!

    adapter.onLoopEvent = async (event: Record<string, unknown>) => {
      // Deepreef emits event.role, not event.type
      // Common roles: "done", "startup", "shutdown", "tool_start", etc.
      const role = (event.role ?? event.type ?? event.eventType ?? "") as string
      let targetPhase: string | null = null

      if (role === "startup") {
        targetPhase = "onStartup"
      } else if (role === "shutdown" || role === "sessionEnd") {
        targetPhase = "onShutdown"
      } else if (role === "done" || role === "stop" || role === "complete") {
        targetPhase = "onGenerationComplete"
      }

      if (!targetPhase || executed.has(targetPhase)) return

      const hooks = lifecycleByPhase.get(targetPhase)
      if (!hooks) return

      executed.add(targetPhase)

      for (const hook of hooks) {
        try {
          await executeHookCommandSafe(
            hook.command,
            workspaceRoot,
            cp.rootDir,
            timeoutMs,
            stdoutMax,
            stderrMax,
          )
        } catch {
          // loop_event hooks must not break the flow
        }
      }
    }
  }

  options.diagnosticCallback?.({
    type: "info",
    pluginId: cp.id,
    message: `Registered ${bridged.length} ECC command hooks from ${cp.name}`,
  })

  return adapter
}

/** Clean lifecycle state when content pack is disposed */
export function clearEccHookState(cp: ResolvedContentPack): void {
  executedLifecyclePhases.delete(cp)
}

/**
 * Execute a hook command with security constraints:
 * - cwd fixed to workspace root
 * - minimal environment (PATH only)
 * - timeout enforcement (child process is killed on timeout)
 * - stdout/stderr length caps
 */
async function executeHookCommandSafe(
  command: string,
  workspaceRoot: string,
  pluginRoot: string,
  timeoutMs: number,
  stdoutMax: number,
  stderrMax: number,
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false

    const child = spawn("sh", ["-c", command], {
      cwd: workspaceRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        // ECC hook commands rely on CLAUDE_PLUGIN_ROOT for script resolution
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        HOME: process.env.HOME ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })

    const killTree = () => {
      // Kill the process group to terminate all descendants
      try { process.kill(-child.pid!, "SIGTERM") } catch { /* already dead */ }
      // Grace period for descendants, then force kill
      setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL") } catch { /* already dead */ }
      }, 1000)
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
      settle({
        code: null,
        stdout,
        stderr,
        error: `Hook command timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`,
      })
    }, timeoutMs)

    const settle = (result: { code: number | null; stdout: string; stderr: string; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill("SIGKILL") } catch { /* no-op */ }
      resolve(result)
    }

    child.stdout?.on("data", (data: Buffer) => {
      if (stdout.length < stdoutMax) {
        stdout += data.toString("utf8").slice(0, stdoutMax - stdout.length)
      }
    })

    child.stderr?.on("data", (data: Buffer) => {
      if (stderr.length < stderrMax) {
        stderr += data.toString("utf8").slice(0, stderrMax - stderr.length)
      }
    })

    child.on("close", (code) => {
      if (!timedOut) {
        if (stdout.length >= stdoutMax) stdout += "\n[output truncated]"
        if (stderr.length >= stderrMax) stderr += "\n[output truncated]"
        settle({ code, stdout, stderr })
      }
    })

    child.on("error", (err) => {
      if (!timedOut) {
        settle({ code: null, stdout, stderr, error: err.message })
      }
    })
  })
}
