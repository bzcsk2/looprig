import { describe, it, expect } from "vitest"
import { createAskUserQuestionTool } from "../src/ask-user.js"
import { createPlanModeTool } from "../src/plan-mode.js"

const ctx = {
  cwd: process.cwd(),
  signal: new AbortController().signal,
  switchAgent: (name: string) => `${name} agent`,
} as any

/** 构造符合 Question 工具 schema 的问题参数 */
function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    questions: [{
      question: "What is your name?",
      header: "Name",
      options: [
        { label: "Alice", description: "First option" },
        { label: "Bob", description: "Second option" },
      ],
      ...overrides,
    }],
  }
}

describe("AskUserQuestion", () => {
  it("should return structured question JSON when askUser is unavailable", async () => {
    const tool = createAskUserQuestionTool()
    const r = await tool.execute(makeQuestion(), ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.type).toBe("question")
    expect(p.questions).toHaveLength(1)
    expect(p.questions[0].question).toBe("What is your name?")
  })

  it("should include options when provided", async () => {
    const tool = createAskUserQuestionTool()
    const r = await tool.execute({
      questions: [{
        question: "Pick one",
        header: "Pick",
        options: [
          { label: "A", description: "Option A" },
          { label: "B", description: "Option B" },
          { label: "C", description: "Option C" },
        ],
      }],
    }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.questions[0].options.map((o: { label: string }) => o.label)).toEqual(["A", "B", "C"])
  })

  it("should reject questions without options", async () => {
    const tool = createAskUserQuestionTool()
    const r = await tool.execute({
      questions: [{ question: "Pick", header: "Pick", options: [] }],
    }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should reject empty question", async () => {
    const tool = createAskUserQuestionTool()
    const r = await tool.execute({
      questions: [{ question: "", header: "Empty", options: [{ label: "A", description: "A" }] }],
    }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should format answers when askUser is available", async () => {
    const tool = createAskUserQuestionTool()
    const askCtx = {
      ...ctx,
      askUser: async () => [["Alice"]],
    }
    const r = await tool.execute(makeQuestion(), askCtx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.answers).toEqual([["Alice"]])
    expect(p.message).toContain("Alice")
  })
})

describe("PlanMode", () => {
  it("should return plan mode on enter", async () => {
    const tool = createPlanModeTool()
    const r = await tool.execute({ action: "enter" }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.mode).toBe("plan")
  })

  it("should return build mode on exit", async () => {
    const tool = createPlanModeTool()
    const r = await tool.execute({ action: "exit" }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.mode).toBe("build")
  })

  it("should reject invalid action", async () => {
    const tool = createPlanModeTool()
    const r = await tool.execute({ action: "invalid" as any }, ctx)
    expect(r.isError).toBe(true)
  })
})
