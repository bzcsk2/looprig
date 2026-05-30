import { describe, it, expect } from "vitest"
import { createCronTool } from "../src/cron.js"
import { createWorktreeTool } from "../src/worktree.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("Cron", () => {
  it("should reject invalid action", async () => {
    const tool = createCronTool()
    const r = await tool.execute({ action: "invalid" as any }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should list jobs (may have crontab or not)", async () => {
    const tool = createCronTool()
    const r = await tool.execute({ action: "list" }, ctx)
    expect(r).toBeDefined()
    const p = JSON.parse(r.content as string)
    expect(p).toHaveProperty("jobs")
  })

  it("should require name for create", async () => {
    const tool = createCronTool()
    const r = await tool.execute({ action: "create", schedule: "0 * * * *", command: "echo hello" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should require schedule for create", async () => {
    const tool = createCronTool()
    const r = await tool.execute({ action: "create", name: "test", command: "echo hello" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should require command for create", async () => {
    const tool = createCronTool()
    const r = await tool.execute({ action: "create", name: "test", schedule: "0 * * * *" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should require name for delete", async () => {
    const tool = createCronTool()
    const r = await tool.execute({ action: "delete" }, ctx)
    expect(r.isError).toBe(true)
  })
})

describe("Worktree", () => {
  it("should reject invalid action", async () => {
    const tool = createWorktreeTool()
    const r = await tool.execute({ action: "invalid" as any }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should require branch for enter", async () => {
    const tool = createWorktreeTool()
    const r = await tool.execute({ action: "enter" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should require path for exit", async () => {
    const tool = createWorktreeTool()
    const r = await tool.execute({ action: "exit" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should detect non-git directory", async () => {
    const tool = createWorktreeTool()
    // Use a temp dir that is not a git repo
    const tmpCtx = { cwd: "/tmp", signal: new AbortController().signal } as any
    const r = await tool.execute({ action: "enter", branch: "test" }, tmpCtx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("Not a git")
  })
})
