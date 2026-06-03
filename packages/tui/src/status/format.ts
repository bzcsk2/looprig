import type { EngineStatusSnapshot } from "@deepicode/core"

export function formatStatus(snapshot: EngineStatusSnapshot): string {
  const lines = [
    "┌─────────────────────────────────────┐",
    "│           Status                    │",
    "├─────────────────────────────────────┤",
    `│ Session: ${snapshot.sessionId.slice(0, 20)}...`.padEnd(38) + "│",
    `│ Agent: ${snapshot.currentAgent}`.padEnd(38) + "│",
    `│ Submitting: ${snapshot.isSubmitting ? "Yes" : "No"}`.padEnd(38) + "│",
    "├─────────────────────────────────────┤",
    "│ Context                             │",
    `│   Window: ${snapshot.context.window}`.padEnd(38) + "│",
    `│   Total: ${snapshot.context.totalTokens}`.padEnd(38) + "│",
    `│   Ratio: ${(snapshot.context.ratio * 100).toFixed(1)}%`.padEnd(38) + "│",
    "├─────────────────────────────────────┤",
    "│ Stats                               │",
    `│   API Calls: ${snapshot.stats.apiCalls}`.padEnd(38) + "│",
    `│   Tool Calls: ${snapshot.stats.toolCalls}`.padEnd(38) + "│",
    `│   Cost: $${snapshot.stats.totalCost.toFixed(4)}`.padEnd(38) + "│",
    "├─────────────────────────────────────┤",
    `│ ${snapshot.timestamp}`.padEnd(38) + "│",
    "└─────────────────────────────────────┘",
  ]
  return lines.join("\n")
}

export function formatStatusCompact(snapshot: EngineStatusSnapshot): string {
  return `Session: ${snapshot.sessionId.slice(0, 8)} | Agent: ${snapshot.currentAgent} | Tokens: ${snapshot.context.totalTokens} | Cost: $${snapshot.stats.totalCost.toFixed(4)}`
}
