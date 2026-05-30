import { describe, it, expect } from "vitest"
import { createTodoWriteTool } from "../src/todowrite.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("todowrite", () => {
  it("should accept valid todos", async () => {
    const tool = createTodoWriteTool()
    const r = await tool.execute({
      todos: [
        { content: "task 1", status: "pending", priority: "high" },
        { content: "task 2", status: "in_progress", priority: "medium" },
      ],
    }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.todos).toHaveLength(2)
    expect(p.summary).toContain("task 1")
    expect(p.summary).toContain("task 2")
  })

  it("should reject empty todos array", async () => {
    const tool = createTodoWriteTool()
    const r = await tool.execute({ todos: [] }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should reject missing todos", async () => {
    const tool = createTodoWriteTool()
    const r = await tool.execute({} as any, ctx)
    expect(r.isError).toBe(true)
  })

  it("should reject todo without content", async () => {
    const tool = createTodoWriteTool()
    const r = await tool.execute({ todos: [{ status: "pending", priority: "high" }] }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should render correct status icons", async () => {
    const tool = createTodoWriteTool()
    const r = await tool.execute({
      todos: [
        { content: "a", status: "completed", priority: "high" },
        { content: "b", status: "in_progress", priority: "medium" },
        { content: "c", status: "cancelled", priority: "low" },
        { content: "d", status: "pending", priority: "low" },
      ],
    }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.summary).toContain("[✓] a")
    expect(p.summary).toContain("[→] b")
    expect(p.summary).toContain("[✗] c")
    expect(p.summary).toContain("[ ] d")
  })
})