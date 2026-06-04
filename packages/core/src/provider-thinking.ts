export type ThinkingMode = "off" | "open" | "high" | "auto"

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
    supportedModes: ["off", "open", "high", "auto"],
    mapMode(mode) {
      if (mode === "off") return { thinking: { type: "disabled" } }
      if (mode === "auto") return { thinking: { type: "enabled" } }
      const result: ThinkingModeMapping = { thinking: { type: "enabled" } }
      if (mode === "high" && supportsReasoningEffort) result.reasoningEffort = "high"
      return result
    },
  }
}
