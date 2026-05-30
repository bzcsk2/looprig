import { describe, it, expect } from "vitest"
import { createSkillTool } from "../src/skills/index.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("SkillTool", () => {
  it("should reject missing command", async () => {
    const tool = createSkillTool()
    const r = await tool.execute({} as any, ctx)
    expect(r.isError).toBe(true)
  })

  it("should reject search without query", async () => {
    const tool = createSkillTool()
    const r = await tool.execute({ command: "search" }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("query")
  })

  it("should reject load without query", async () => {
    const tool = createSkillTool()
    const r = await tool.execute({ command: "load" }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("skill name")
  })

  it("should reject unknown command", async () => {
    const tool = createSkillTool()
    const r = await tool.execute({ command: "invalid" }, ctx)
    expect(r.isError).toBe(true)
  })
})