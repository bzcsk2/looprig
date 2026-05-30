import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createTaskCreateTool } from "../src/task-create.js"
import { createTaskUpdateTool } from "../src/task-update.js"
import { createTaskListTool } from "../src/task-list.js"
import { createTaskGetTool } from "../src/task-get.js"
import { createTaskStopTool } from "../src/task-stop.js"
import { rmSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal }) as any

describe("TaskCreate", () => {
  let tmpDir: string
  beforeEach(() => { tmpDir = join(tmpdir(), `tc-${Date.now()}`); mkdirSync(join(tmpDir, ".deepicode"), { recursive: true }) })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should create a task", async () => {
    const tool = createTaskCreateTool()
    const r = await tool.execute({ content: "new task", priority: "high" }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.content).toBe("new task")
    expect(p.priority).toBe("high")
  })

  it("should default priority to medium", async () => {
    const tool = createTaskCreateTool()
    const r = await tool.execute({ content: "default" }, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.priority).toBe("medium")
  })

  it("should reject empty content", async () => {
    const tool = createTaskCreateTool()
    const r = await tool.execute({ content: "" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })
})

describe("TaskUpdate", () => {
  let tmpDir: string
  let taskId: string
  beforeEach(async () => {
    tmpDir = join(tmpdir(), `tu-${Date.now()}`); mkdirSync(join(tmpDir, ".deepicode"), { recursive: true })
    const create = createTaskCreateTool()
    const r = await create.execute({ content: "to update" }, ctx(tmpDir))
    taskId = JSON.parse(r.content as string).id
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should update task status", async () => {
    const tool = createTaskUpdateTool()
    const r = await tool.execute({ id: taskId, status: "completed" }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.status).toBe("completed")
  })

  it("should return error for non-existent id", async () => {
    const tool = createTaskUpdateTool()
    const r = await tool.execute({ id: "nonexistent", status: "completed" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })
})

describe("TaskList", () => {
  let tmpDir: string
  beforeEach(async () => {
    tmpDir = join(tmpdir(), `tl-${Date.now()}`); mkdirSync(join(tmpDir, ".deepicode"), { recursive: true })
    const create = createTaskCreateTool()
    await create.execute({ content: "high-pri", priority: "high" }, ctx(tmpDir))
    await create.execute({ content: "low-pri", priority: "low" }, ctx(tmpDir))
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should list all tasks", async () => {
    const tool = createTaskListTool()
    const r = await tool.execute({}, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.count).toBe(2)
  })

  it("should filter by priority", async () => {
    const tool = createTaskListTool()
    const r = await tool.execute({ priority: "high" }, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.count).toBe(1)
  })

  it("should filter by status", async () => {
    const tool = createTaskListTool()
    // both tasks have default status pending
    const r = await tool.execute({ status: "pending" }, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.count).toBe(2)
    expect(p.tasks.every((t: any) => t.status === "pending")).toBe(true)
  })

  it("should return empty list for non-matching status", async () => {
    const tool = createTaskListTool()
    const r = await tool.execute({ status: "completed" }, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.count).toBe(0)
    expect(p.tasks).toEqual([])
  })
})

describe("TaskList empty", () => {
  let tmpDir: string
  beforeEach(() => { tmpDir = join(tmpdir(), `tle-${Date.now()}`); mkdirSync(join(tmpDir, ".deepicode"), { recursive: true }) })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should return empty list when no tasks exist", async () => {
    const tool = createTaskListTool()
    const r = await tool.execute({}, ctx(tmpDir))
    const p = JSON.parse(r.content as string)
    expect(p.count).toBe(0)
    expect(p.tasks).toEqual([])
  })
})

describe("TaskGet", () => {
  let tmpDir: string
  let taskId: string
  beforeEach(async () => {
    tmpDir = join(tmpdir(), `tg-${Date.now()}`); mkdirSync(join(tmpDir, ".deepicode"), { recursive: true })
    const create = createTaskCreateTool()
    const r = await create.execute({ content: "get me" }, ctx(tmpDir))
    taskId = JSON.parse(r.content as string).id
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should get task by id", async () => {
    const tool = createTaskGetTool()
    const r = await tool.execute({ id: taskId }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content as string).content).toBe("get me")
  })

  it("should error on non-existent id", async () => {
    const tool = createTaskGetTool()
    const r = await tool.execute({ id: "nope" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })
})

describe("TaskStop", () => {
  let tmpDir: string
  let taskId: string
  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ts-${Date.now()}`); mkdirSync(join(tmpDir, ".deepicode"), { recursive: true })
    const create = createTaskCreateTool()
    const r = await create.execute({ content: "stop me" }, ctx(tmpDir))
    taskId = JSON.parse(r.content as string).id
  })
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

  it("should stop a task", async () => {
    const tool = createTaskStopTool()
    const r = await tool.execute({ id: taskId }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content as string).status).toBe("cancelled")
  })

  it("should error on non-existent id", async () => {
    const tool = createTaskStopTool()
    const r = await tool.execute({ id: "nope" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })
})
