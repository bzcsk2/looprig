import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { TaskManager } from "../src/task-manager.js"
import { rm, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync, writeFileSync } from "node:fs"

describe("TaskManager", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `deepicode-task-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(tmpDir, ".deepicode"), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }) {
    try { rm(p, opts || { recursive: true, force: true }, () => {}) } catch {}
  }

  it("should create a task with generated id", () => {
    const mgr = new TaskManager(tmpDir)
    const task = mgr.create({ content: "test task", status: "pending", priority: "high" })
    expect(task.id).toBeTruthy()
    expect(task.content).toBe("test task")
    expect(task.status).toBe("pending")
    expect(task.priority).toBe("high")
    expect(task.createdAt).toBeGreaterThan(0)
    expect(task.updatedAt).toBeGreaterThan(0)
  })

  it("should list tasks", () => {
    const mgr = new TaskManager(tmpDir)
    mgr.create({ content: "task 1", status: "pending", priority: "medium" })
    mgr.create({ content: "task 2", status: "in_progress", priority: "high" })
    const tasks = mgr.list()
    expect(tasks).toHaveLength(2)
  })

  it("should get a task by id", () => {
    const mgr = new TaskManager(tmpDir)
    const created = mgr.create({ content: "find me", status: "pending", priority: "low" })
    const found = mgr.get(created.id)
    expect(found).toBeDefined()
    expect(found!.content).toBe("find me")
  })

  it("should return undefined for non-existent id", () => {
    const mgr = new TaskManager(tmpDir)
    expect(mgr.get("nonexistent")).toBeUndefined()
  })

  it("should update a task", () => {
    const mgr = new TaskManager(tmpDir)
    const created = mgr.create({ content: "update me", status: "pending", priority: "low" })
    const updated = mgr.update(created.id, { status: "completed", priority: "high" })
    expect(updated).toBe(true)
    const task = mgr.get(created.id)
    expect(task!.status).toBe("completed")
    expect(task!.priority).toBe("high")
  })

  it("should return false when updating non-existent task", () => {
    const mgr = new TaskManager(tmpDir)
    expect(mgr.update("nonexistent", { status: "completed" })).toBe(false)
  })

  it("should stop a task", () => {
    const mgr = new TaskManager(tmpDir)
    const created = mgr.create({ content: "stop me", status: "in_progress", priority: "medium" })
    const stopped = mgr.stop(created.id)
    expect(stopped).toBe(true)
    expect(mgr.get(created.id)!.status).toBe("cancelled")
  })

  it("should persist tasks to disk", () => {
    const mgr1 = new TaskManager(tmpDir)
    const t = mgr1.create({ content: "persist test", status: "pending", priority: "high" })

    const mgr2 = new TaskManager(tmpDir)
    const loaded = mgr2.get(t.id)
    expect(loaded).toBeDefined()
    expect(loaded!.content).toBe("persist test")
  })

  it("should not crash on corrupted tasks.json", () => {
    writeFileSync(join(tmpDir, ".deepicode", "tasks.json"), "corrupted {{ json", "utf-8")
    const mgr = new TaskManager(tmpDir)
    const tasks = mgr.list()
    expect(tasks).toEqual([])
  })

  it("should not crash on empty tasks.json", () => {
    writeFileSync(join(tmpDir, ".deepicode", "tasks.json"), "", "utf-8")
    const mgr = new TaskManager(tmpDir)
    const tasks = mgr.list()
    expect(tasks).toEqual([])
  })

  it("should support concurrent task creation without conflicts", async () => {
    const mgr = new TaskManager(tmpDir)
    const p1 = Promise.resolve(mgr.create({ content: "task1", status: "pending", priority: "high" }))
    const p2 = Promise.resolve(mgr.create({ content: "task2", status: "pending", priority: "low" }))
    const [t1, t2] = await Promise.all([p1, p2])
    expect(t1.id).not.toBe(t2.id)
    expect(mgr.list()).toHaveLength(2)
  })
})
