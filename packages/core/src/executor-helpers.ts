import type { AgentTool, ToolResult, ToolProgressUpdate } from "./interface.js"
import type { ToolCall } from "./types.js"
import type { PermissionEngine, HookManager, PermissionDecision } from "@deepicode/security"
import { maybePersistResult, type ResultPersistenceConfig } from "./result-persistence.js"
import { type RuntimeLogger } from "./runtime-logger.js"
import { repairToolArguments } from "./context/repair.js"

// ─── Permission Decision Helper ───

export type PermissionOutcome = "allow" | "deny" | "ask" | "invalid"

export type ParsedToolCallArgs =
  | { ok: true; args: Record<string, unknown>; repaired: boolean }
  | { ok: false; error: string }

export function parseToolCallArgs(raw: string, toolName: string): ParsedToolCallArgs {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: `Invalid JSON arguments for tool ${toolName}: arguments must be a JSON object` }
    }
    return { ok: true, args: parsed as Record<string, unknown>, repaired: false }
  } catch {
    const repaired = repairToolArguments(raw)
    if (!repaired.success) {
      return { ok: false, error: `Invalid JSON arguments for tool ${toolName}: failed all repair stages` }
    }
    if (repaired.partial) {
      return { ok: false, error: `Invalid JSON arguments for tool ${toolName}: partial repair is unsafe` }
    }
    return { ok: true, args: repaired.args, repaired: true }
  }
}

/**
 * CL-50: Evaluate whether a tool call should be allowed, denied, or requires user confirmation.
 * Pure function — no side effects beyond the provided callbacks.
 */
export async function evaluatePermission(
  tc: ToolCall,
  tools: Map<string, AgentTool>,
  permissionEngine?: PermissionEngine,
  hookManager?: HookManager,
  requestPermission?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
  parsedArgs?: Record<string, unknown>,
): Promise<PermissionOutcome> {
  const handler = tools.get(tc.function.name)
  if (!handler || !permissionEngine) return "allow"

  const argsResult = parsedArgs ? { ok: true as const, args: parsedArgs, repaired: false } : parseToolCallArgs(tc.function.arguments, tc.function.name)
  if (!argsResult.ok) return "invalid"
  const args = argsResult.args

  const check = permissionEngine.decide(tc.function.name, args, handler.approval)
  if (check?.decision !== "ask") return "allow"

  let hookDecision: PermissionDecision | void
  try {
    hookDecision = await hookManager?.runBeforeToolCall({
      toolName: tc.function.name, args, tier: handler.approval,
      permissionDecision: "ask", permissionReason: check.reason,
    })
  } catch { hookDecision = "deny" }

  if (hookDecision === "allow") return "allow"
  if (hookDecision === "deny") return "deny"
  if (requestPermission) return "ask"
  return "deny"
}

// ─── Settle Ledger ───

export interface SettleLedger {
  settle: (tc: ToolCall, index: number, result: ToolResult) => boolean
  isSettled: (index: number) => boolean
  unsettledIndices: () => number[]
}

/**
 * CL-50: Tracks which tool call indices have already written a result.
 * Every branch (success, error, permission deny, user deny, abort) must go
 * through settle() which checks the set before calling appendToolResult.
 */
export function createSettleLedger(
  appendToolResult: (tc: ToolCall, result: ToolResult) => void,
): SettleLedger {
  const settled = new Set<number>()

  return {
    settle(tc, index, result) {
      if (settled.has(index)) return false
      settled.add(index)
      appendToolResult(tc, result)
      return true
    },
    isSettled(index) {
      return settled.has(index)
    },
    unsettledIndices() {
      const indices: number[] = []
      // We don't know the total count here, so callers track via toolCalls.length
      return indices
    },
  }
}

// ─── Bounded Progress Queue ───

export interface ProgressQueue {
  push: (update: ToolProgressUpdate) => void
  flush: () => ToolProgressUpdate[]
  length: () => number
}

/**
 * CL-50: Buffers progress updates during tool execution.
 * Flush yields all buffered updates in order and resets the buffer.
 */
export function createProgressQueue(): ProgressQueue {
  const buffer: ToolProgressUpdate[] = []
  return {
    push(update) { buffer.push(update) },
    flush() { const items = [...buffer]; buffer.length = 0; return items },
    length() { return buffer.length },
  }
}

// ─── Result Persistence Adapter ───

/**
 * CL-50: Apply overflow persistence to a tool result.
 * Returns the possibly-modified result with persisted metadata attached.
 * Pure adapter — no control flow, just data transformation.
 */
export async function applyResultPersistence(
  rawResult: ToolResult,
  sessionId: string,
  toolName: string,
  config: ResultPersistenceConfig,
  hookManager?: HookManager,
  logger?: RuntimeLogger,
): Promise<ToolResult> {
  if (rawResult.isError) return rawResult

  const persisted = await maybePersistResult(
    rawResult.content,
    sessionId,
    toolName,
    config,
    logger,
  )

  const result: ToolResult = { ...rawResult, content: persisted.content }
  if (persisted.persisted) {
    result.metadata = { ...result.metadata, ...persisted.persisted }
  }
  if (persisted.warning) {
    hookManager?.runAfterToolCall(toolName, { content: persisted.warning, isError: false, metadata: { warning: true } })
  }
  return result
}
