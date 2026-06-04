import type { ThinkingMode } from "./provider-thinking.js"

export type SwitchSignal = {
  currentMode: ThinkingMode
  toolCallCount: number
  textLength: number
  loopCount: number
  retryCount: number
  hasError: boolean
}

export type SwitchDecision =
  | { action: "keep"; reason: string }
  | { action: "switch"; target: ThinkingMode; reason: string }

const COOLDOWN_MS = 120_000
const ERROR_THRESHOLD = 3
const ERROR_WINDOW_MS = 10 * 60_000
const EMERGENCY_RECOVERY_MS = 5 * 60_000 // 5 minutes recovery time

export type ModeSelectorState = {
  currentMode: ThinkingMode
  lastSwitchTime: number
  errorHistory: number[]
  emergencyMode: boolean
  emergencyPreviousMode: ThinkingMode | null
}

export function createModeSelectorState(initial: ThinkingMode = "off"): ModeSelectorState {
  return {
    currentMode: initial,
    lastSwitchTime: 0,
    errorHistory: [],
    emergencyMode: false,
    emergencyPreviousMode: null,
  }
}

export function evaluateModeSwitch(
  state: ModeSelectorState,
  signal: SwitchSignal,
  now: number = Date.now()
): SwitchDecision {
  if (state.emergencyMode) {
    // Auto-recover after EMERGENCY_RECOVERY_MS
    if (now - state.lastSwitchTime >= EMERGENCY_RECOVERY_MS) {
      state.emergencyMode = false
      state.emergencyPreviousMode = null
      // Continue with normal evaluation
    } else {
      return { action: "keep", reason: "emergency_mode_active" }
    }
  }

  const cooldownRemaining = COOLDOWN_MS - (now - state.lastSwitchTime)
  if (cooldownRemaining > 0) {
    return { action: "keep", reason: `cooldown_${cooldownRemaining}ms` }
  }

  if (signal.toolCallCount > 3 && signal.loopCount > 5) {
    if (signal.currentMode !== "off") {
      return { action: "switch", target: "off", reason: "complex_tool_chain_reduce_overhead" }
    }
  }

  if (signal.retryCount >= 2 && signal.currentMode !== "off") {
    return { action: "switch", target: "off", reason: "retry_backoff_disable_thinking" }
  }

  if (signal.hasError && signal.currentMode !== "off") {
    state.emergencyMode = true
    state.emergencyPreviousMode = signal.currentMode
    state.lastSwitchTime = now
    state.errorHistory.push(now)
    state.errorHistory = state.errorHistory.filter(t => now - t < ERROR_WINDOW_MS)
    return { action: "switch", target: "off", reason: "emergency_error_disable_thinking" }
  }

  state.errorHistory = state.errorHistory.filter(t => now - t < ERROR_WINDOW_MS)
  if (state.errorHistory.length >= ERROR_THRESHOLD) {
    if (signal.currentMode !== "off") {
      return { action: "switch", target: "off", reason: `error_frequency_${state.errorHistory.length}_in_window` }
    }
  }

  if (signal.toolCallCount <= 1 && signal.loopCount <= 2 && signal.textLength < 500 && signal.retryCount === 0 && !signal.hasError) {
    if (signal.currentMode === "off") {
      return { action: "switch", target: "open", reason: "simple_query_enable_thinking" }
    }
  }

  return { action: "keep", reason: "no_rule_matched" }
}

export function resetEmergency(state: ModeSelectorState, now: number = Date.now()): void {
  state.emergencyMode = false
  state.emergencyPreviousMode = null
  state.lastSwitchTime = now
}
