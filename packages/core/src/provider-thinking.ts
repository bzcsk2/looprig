export type ThinkingMode = "off" | "low" | "medium" | "high" | "max"

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
    supportedModes: ["off", "low", "medium", "high", "max"],
    mapMode(mode) {
      if (mode === "off") return { thinking: { type: "disabled" } }
      const result: ThinkingModeMapping = { thinking: { type: "enabled" } }
      if (supportsReasoningEffort) result.reasoningEffort = mode
      return result
    },
  }
}
