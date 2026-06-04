import { describe, it, expect } from "vitest"
import { SubagentRunner } from "../src/subagent/run.js"
import type { AgentTool } from "../src/interface.js"

describe("SubagentRunner", () => {
  it("should have registry with built-in definitions", () => {
    const runner = new SubagentRunner({} as any)
    expect(runner.getRegistry().has("general-purpose")).toBe(true)
    expect(runner.getRegistry().has("Explore")).toBe(true)
    expect(runner.getRegistry().has("Plan")).toBe(true)
  })

  it("should resolve definition correctly", () => {
    const runner = new SubagentRunner({} as any)
    const def = runner.resolveDefinition("general-purpose")
    expect(def.name).toBe("general-purpose")
    expect(def.permissionMode).toBe("denyExec")
  })

  it("should resolve to general-purpose when no type given", () => {
    const runner = new SubagentRunner({} as any)
    const def = runner.resolveDefinition(undefined)
    expect(def.name).toBe("general-purpose")
  })

  it("should throw for unknown subagent type", () => {
    const runner = new SubagentRunner({} as any)
    expect(() => runner.resolveDefinition("bad-type")).toThrow("Unknown subagent type")
  })

  it("should require prompt and description", async () => {
    const runner = new SubagentRunner({} as any)
    await expect(runner.spawnAndRun(
      { description: "", prompt: "do something" },
      new Map(),
      null as any,
    )).rejects.toThrow("requires both prompt and description")

    await expect(runner.spawnAndRun(
      { description: "test", prompt: "" },
      new Map(),
      null as any,
    )).rejects.toThrow("requires both prompt and description")
  })

  it("should filter out AgentTool from child tools", () => {
    const runner = new SubagentRunner({} as any)
    const def = runner.resolveDefinition("general-purpose")
    expect(def.disallowedTools).toContain("AgentTool")
  })
})

describe("SubagentDefinition tool filtering", () => {
  it("Explore should have read-only tools", () => {
    const runner = new SubagentRunner({} as any)
    const def = runner.resolveDefinition("Explore")
    expect(def.tools).toContain("read_file")
    expect(def.tools).toContain("grep")
    expect(def.tools).toContain("glob")
    expect(def.tools).not.toContain("write_file")
    expect(def.tools).not.toContain("edit")
    expect(def.tools).not.toContain("bash")
  })

  it("Plan should allow todowrite", () => {
    const runner = new SubagentRunner({} as any)
    const def = runner.resolveDefinition("Plan")
    expect(def.tools).toContain("todowrite")
  })

  it("general-purpose should have broad tool access", () => {
    const runner = new SubagentRunner({} as any)
    const def = runner.resolveDefinition("general-purpose")
    expect(def.tools).toEqual(["*"])
  })
})
