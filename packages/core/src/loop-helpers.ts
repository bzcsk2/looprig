import type { ToolCall } from "./types.js"
import type { LoopEvent, SessionStats } from "./interface.js"
import type { ContextManager } from "./context/manager.js"
import type { AsyncSessionWriter } from "./session.js"
import type { ModeSelectorState, SwitchSignal } from "./mode-selector.js"
import type { ThinkingMode } from "./provider-thinking.js"
import { evaluateModeSwitch } from "./mode-selector.js"
import type { ModeStats } from "./mode-stats.js"
import { logModeSwitch } from "./mode-stats.js"
import { randomUUID } from "node:crypto"
import type { PendingInstruction } from "./loop.js"

// ─── Tool Call ID Normalize ───

let toolCallSeq = 0

/** CL-51: Normalize tool call ID: ensure non-empty, stable, unique per turn. */
export function normalizeToolCallId(rawId: string | undefined, toolName: string): string {
  if (rawId && rawId.trim()) return rawId.trim()
  return `${toolName}-${++toolCallSeq}-${randomUUID()}`
}

/** CL-51: Reset per-turn sequence counter. */
export function resetToolCallSeq(): void {
  toolCallSeq = 0
}

// ─── Duplicate Tool-Call Detector ───

export interface DuplicateDetector {
  check: (tc: ToolCall) => { duplicate: boolean; blocked: boolean; count: number; warning?: string }
}

export const DUPLICATE_TOOL_WARNING_THRESHOLD = 3
export const DUPLICATE_TOOL_BLOCK_THRESHOLD = 5

/**
 * CL-51: Tracks tool calls and detects loops (same tool+args called repeatedly).
 * Pure data structure — no side effects.
 */
export function createDuplicateDetector(): DuplicateDetector {
  const recentToolCalls = new Map<string, number>()

  return {
    check(tc) {
      const key = `${tc.function.name}:${tc.function.arguments}`
      const count = (recentToolCalls.get(key) ?? 0) + 1
      recentToolCalls.set(key, count)
      if (count >= DUPLICATE_TOOL_BLOCK_THRESHOLD) {
        return {
          duplicate: true,
          blocked: true,
          count,
          warning: `Tool call loop stopped: ${tc.function.name} called ${count} times with identical arguments`,
        }
      }
      if (count >= DUPLICATE_TOOL_WARNING_THRESHOLD) {
        return {
          duplicate: true,
          blocked: false,
          count,
          warning: `Tool call loop detected: ${tc.function.name} called ${count} times with identical arguments`,
        }
      }
      return { duplicate: false, blocked: false, count }
    },
  }
}

// ─── Mode Switch Signal ───

export interface ModeSwitchResult {
  switched: boolean
  from?: ThinkingMode
  to?: ThinkingMode
  reason?: string
}

/**
 * CL-51: Build a SwitchSignal and evaluate whether to switch thinking modes.
 * Returns the decision without side effects — caller handles state updates and yielding.
 */
export function evaluateModeSwitchForTurn(
  modeSelectorState: ModeSelectorState,
  currentMode: ThinkingMode,
  totalToolCalls: number,
  fullContentLength: number,
  turnCount: number,
  consecutiveErrors: number,
  hasError: boolean,
): ModeSwitchResult {
  const signalBundle: SwitchSignal = {
    currentMode,
    toolCallCount: totalToolCalls,
    textLength: fullContentLength,
    loopCount: turnCount,
    retryCount: consecutiveErrors,
    hasError,
  }
  const decision = evaluateModeSwitch(modeSelectorState, signalBundle)
  if (decision.action === "switch") {
    return { switched: true, from: currentMode, to: decision.target, reason: decision.reason }
  }
  return { switched: false }
}

// ─── Pending Instruction Safe-Point ───

/**
 * CL-51: Consume one pending instruction from the queue and inject it into context.
 * Returns a status event if an instruction was injected, null otherwise.
 */
export function injectPendingInstruction(
  takePendingInstruction: (() => PendingInstruction | null) | undefined,
  ctx: ContextManager,
  sessionWriter: AsyncSessionWriter | undefined,
  turnCount: number,
): LoopEvent | null {
  const pending = takePendingInstruction?.()
  if (!pending) return null
  ctx.log.append({ role: "user", content: pending.content })
  sessionWriter?.enqueue({ ts: Date.now(), type: "messages", payload: ctx.buildMessages() })
  return {
    role: "status",
    content: "instruction_injected",
    metadata: {
      kind: "instruction_injected",
      queueLength: pending.remaining,
      turnCount,
    },
  }
}
