import { describe, it, expect } from "vitest"
import { getAgent, agentConfigFor, AGENTS, getMainMode, MAIN_MODES } from "../src/agent.js"

describe("getAgent", () => {
  it("should return Build Agent definition for 'build'", () => {
    const agent = getAgent("build")
    expect(agent.name).toBe("build")
    expect(agent.label).toBe("Build Mode")
  })

  it("should return Plan Agent definition for 'plan'", () => {
    const agent = getAgent("plan")
    expect(agent.name).toBe("plan")
    expect(agent.label).toBe("Plan Mode")
  })

  it("should fallback to build for unknown agent", () => {
    const agent = getAgent("nonexistent")
    expect(agent.name).toBe("build")
  })

  it("should have at least 30 tools for build agent", () => {
    const agent = getAgent("build")
    expect(agent.toolNames!.length).toBeGreaterThanOrEqual(30)
  })

  it("should have 4 tools for plan agent", () => {
    const agent = getAgent("plan")
    expect(agent.toolNames!).toHaveLength(4)
    expect(agent.toolNames).toContain("read_file")
    expect(agent.toolNames).toContain("list_dir")
    expect(agent.toolNames).toContain("grep")
    expect(agent.toolNames).toContain("todowrite")
  })
})

describe("getMainMode", () => {
  it("should return build mode by default", () => {
    const mode = getMainMode("unknown")
    expect(mode.name).toBe("build")
    expect(mode.permissionProfile).toBe("build")
  })

  it("should return plan mode with readonly profile", () => {
    const mode = getMainMode("plan")
    expect(mode.name).toBe("plan")
    expect(mode.permissionProfile).toBe("readonly")
  })
})

describe("agentConfigFor", () => {
  it("should return default config for build agent", () => {
    const cfg = agentConfigFor("build")
    expect(cfg.name).toBe("build")
    expect(cfg.toolNames).toBeDefined()
  })

  it("should apply overrides", () => {
    const cfg = agentConfigFor("build", { toolNames: ["bash"], systemPrompt: "custom" })
    expect(cfg.toolNames).toEqual(["bash"])
    expect(cfg.systemPrompt).toBe("custom")
  })
})
