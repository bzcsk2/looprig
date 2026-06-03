import { describe, it, expect } from "vitest"
import { parseSlashCommand, buildHelpText } from "../src/commands.js"
import { formatStatus, formatStatusCompact } from "../src/status/format.js"
import type { EngineStatusSnapshot } from "@deepicode/core"

describe("Slash Command /status", () => {
  it("parseSlashCommand recognizes /status", () => {
    const result = parseSlashCommand("/status")
    expect(result).toEqual({ name: "status" })
  })

  it("parseSlashCommand recognizes /status with whitespace", () => {
    const result = parseSlashCommand("  /status  ")
    expect(result).toEqual({ name: "status" })
  })

  it("buildHelpText includes /status", () => {
    const helpText = buildHelpText("build", {
      cmdExit: "Exit the program",
      cmdHelp: "Show this help",
      cmdModel: "Switch model",
      cmdSessions: "List sessions",
      cmdAgent: "Switch agent",
      cmdSkill: "List skills",
      cmdLang: "Switch language",
      cmdStatus: "Show status",
    })
    expect(helpText).toContain("/status")
    expect(helpText).toContain("Show status")
  })
})

describe("Status Format", () => {
  const mockSnapshot: EngineStatusSnapshot = {
    sessionId: "test-session-12345678901234567890",
    context: {
      prefixTokens: 1000,
      logTokens: 2000,
      scratchTokens: 500,
      totalTokens: 3500,
      window: 128000,
      ratio: 0.027,
    },
    stats: {
      promptTokens: 1000,
      completionTokens: 500,
      cacheHitTokens: 800,
      cacheMissTokens: 200,
      apiCalls: 5,
      toolCalls: 3,
      totalCost: 0.0123,
    },
    currentAgent: "build",
    isSubmitting: false,
    timestamp: "2026-06-03T12:00:00.000Z",
  }

  it("formatStatus returns formatted string", () => {
    const result = formatStatus(mockSnapshot)
    expect(result).toContain("Status")
    expect(result).toContain("test-session-1234")
    expect(result).toContain("build")
    expect(result).toContain("No")
    expect(result).toContain("128000")
    expect(result).toContain("3500")
    expect(result).toContain("2.7%")
    expect(result).toContain("5")
    expect(result).toContain("3")
    expect(result).toContain("$0.0123")
    expect(result).toContain("2026-06-03T12:00:00.000Z")
  })

  it("formatStatusCompact returns compact string", () => {
    const result = formatStatusCompact(mockSnapshot)
    expect(result).toContain("Session: test-ses")
    expect(result).toContain("Agent: build")
    expect(result).toContain("Tokens: 3500")
    expect(result).toContain("Cost: $0.0123")
  })

  it("formatStatus shows submitting state", () => {
    const submittingSnapshot = { ...mockSnapshot, isSubmitting: true }
    const result = formatStatus(submittingSnapshot)
    expect(result).toContain("Yes")
  })
})
