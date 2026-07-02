import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { GoalStore } from "../src/goal/store.js"
import { createGetGoalTool, createUpdateGoalTool, createGoalTools } from "../src/goal/tools.js"
import type { GoalToolProvider } from "../src/goal/tools.js"

const TEST_DIR = resolve(process.cwd(), ".covalo-test-goal-tools")

function makeStore(): GoalStore {
  return new GoalStore(TEST_DIR)
}

function makeProvider(store: GoalStore, threadId: string): GoalToolProvider {
  return {
    getGoalStore: () => store,
    getThreadId: () => threadId,
  }
}

describe("Goal tools", () => {
  let store: GoalStore
  let threadId: string
  let provider: GoalToolProvider

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    store = makeStore()
    threadId = randomUUID()
    provider = makeProvider(store, threadId)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("get_goal", () => {
    it("returns 'No goal' when no goal exists", async () => {
      const tool = createGetGoalTool(provider)
      const result = await tool.execute({}, {} as any)
      expect(result.isError).toBe(false)
      expect(result.content).toBe("No goal set for this thread.")
    })

    it("returns goal when one exists", async () => {
      const created = store.createGoal(threadId, "Test goal")
      const tool = createGetGoalTool(provider)
      const result = await tool.execute({}, {} as any)
      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.content)
      expect(parsed.objective).toBe("Test goal")
      expect(parsed.goalId).toBe(created.goalId)
      expect(parsed.status).toBe("active")
    })
  })

  describe("update_goal", () => {
    it("returns error for invalid status", async () => {
      const tool = createUpdateGoalTool(provider)
      const result = await tool.execute({ status: "active" }, {} as any)
      expect(result.isError).toBe(true)
      expect(result.content).toContain('status must be "complete" or "blocked"')
    })

    it("marks goal as complete", async () => {
      store.createGoal(threadId, "Test")
      const tool = createUpdateGoalTool(provider)
      const result = await tool.execute({ status: "complete" }, {} as any)
      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.content)
      expect(parsed.status).toBe("complete")
    })

    it("marks goal as blocked", async () => {
      store.createGoal(threadId, "Test")
      const tool = createUpdateGoalTool(provider)
      const result = await tool.execute({ status: "blocked" }, {} as any)
      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.content)
      expect(parsed.status).toBe("blocked")
    })

    it("returns error when no goal exists", async () => {
      const tool = createUpdateGoalTool(provider)
      const result = await tool.execute({ status: "complete" }, {} as any)
      expect(result.isError).toBe(true)
      expect(result.content).toContain("No goal found")
    })
  })

  describe("createGoalTools", () => {
    it("returns get_goal and update_goal", () => {
      const tools = createGoalTools(provider)
      expect(tools).toHaveLength(2)
      expect(tools[0].name).toBe("get_goal")
      expect(tools[1].name).toBe("update_goal")
    })
  })
})
