import { describe, it, expect } from "vitest"
import { SubagentRegistry, BUILTIN_SUBAGENTS } from "../src/subagent/index.js"

describe("SubagentRegistry", () => {
  it("should load built-in definitions", () => {
    const registry = new SubagentRegistry()
    expect(registry.has("general-purpose")).toBe(true)
    expect(registry.has("Explore")).toBe(true)
    expect(registry.has("Plan")).toBe(true)
  })

  it("should resolve general-purpose by default", () => {
    const registry = new SubagentRegistry()
    const def = registry.resolve("general-purpose")
    expect(def.name).toBe("general-purpose")
    expect(def.permissionMode).toBe("denyExec")
    expect(def.maxTurns).toBe(20)
  })

  it("should resolve Explore with readonly permission", () => {
    const registry = new SubagentRegistry()
    const def = registry.resolve("Explore")
    expect(def.name).toBe("Explore")
    expect(def.permissionMode).toBe("readonly")
    expect(def.maxTurns).toBe(8)
    expect(def.tools).toContain("read_file")
    expect(def.tools).not.toContain("bash")
  })

  it("should resolve Plan with readonly permission", () => {
    const registry = new SubagentRegistry()
    const def = registry.resolve("Plan")
    expect(def.name).toBe("Plan")
    expect(def.permissionMode).toBe("readonly")
    expect(def.tools).toContain("todowrite")
  })

  it("should throw for unknown subagent type", () => {
    const registry = new SubagentRegistry()
    expect(() => registry.resolve("nonexistent")).toThrow("Unknown subagent type")
  })

  it("should throw error message listing available types", () => {
    const registry = new SubagentRegistry()
    try {
      registry.resolve("bad-type")
      expect.fail("should have thrown")
    } catch (e: any) {
      expect(e.message).toContain("general-purpose")
      expect(e.message).toContain("Explore")
    }
  })

  it("should register custom definition", () => {
    const registry = new SubagentRegistry()
    registry.register({
      name: "reviewer",
      description: "Code reviewer",
      permissionMode: "readonly",
      systemPrompt: "Review code",
      tools: ["read_file", "grep"],
      maxTurns: 5,
    })
    expect(registry.has("reviewer")).toBe(true)
    const def = registry.resolve("reviewer")
    expect(def.description).toBe("Code reviewer")
  })

  it("should get all definitions", () => {
    const registry = new SubagentRegistry()
    const all = registry.getAll()
    expect(all.length).toBeGreaterThanOrEqual(3)
    expect(all.find(d => d.name === "Plan")).toBeDefined()
  })

  it("should filter tools correctly with getEffectiveTools", () => {
    const registry = new SubagentRegistry()
    const planDef = registry.resolve("Plan")
    const tools = registry.getEffectiveTools(planDef)
    expect(tools).toContain("read_file")
    expect(tools).not.toContain("bash")
    expect(tools).not.toContain("write_file")
  })

  it("getEffectiveTools should return undefined for wildcard tools", () => {
    const registry = new SubagentRegistry()
    const def = registry.resolve("general-purpose")
    const tools = registry.getEffectiveTools(def)
    expect(tools).toBeUndefined()
  })
})

describe("BUILTIN_SUBAGENTS", () => {
  it("should export all built-in definitions", () => {
    expect(BUILTIN_SUBAGENTS).toHaveLength(3)
    const names = BUILTIN_SUBAGENTS.map(d => d.name)
    expect(names).toContain("general-purpose")
    expect(names).toContain("Explore")
    expect(names).toContain("Plan")
  })

  it("all definitions should disallow AgentTool", () => {
    for (const def of BUILTIN_SUBAGENTS) {
      expect(def.disallowedTools).toContain("AgentTool")
    }
  })
})
