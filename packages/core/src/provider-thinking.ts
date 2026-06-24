export type ThinkingMode = "off" | "open" | "high" | "max"

export interface ThinkingModeMapping {
  thinking?: { type: "enabled" | "disabled" }
  reasoningEffort?: "low" | "medium" | "high" | "max"
}

export interface ProviderThinkingCapabilities {
  supportedModes: ThinkingMode[]
  mapMode(mode: ThinkingMode): ThinkingModeMapping | null
}

export function createDeepSeekCapabilities(provider?: string): ProviderThinkingCapabilities {
  const supportsReasoningEffort = provider === "deepseek"
  return {
    supportedModes: ["off", "high", "max"],
    mapMode(mode) {
      if (mode === "off") return { thinking: { type: "disabled" } }
      const result: ThinkingModeMapping = { thinking: { type: "enabled" } }
      if (supportsReasoningEffort) {
        if (mode === "max") result.reasoningEffort = "max"
        else result.reasoningEffort = "high"
      }
      return result
    },
  }
}
