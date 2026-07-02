import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { GoalStore } from "../src/goal/store.js"

import { setPromptLocale } from "../src/prompt-locale";
const TEST_DIR = resolve(process.cwd(), ".covalo-test-goal")

function makeStore(): GoalStore {
  return new GoalStore(TEST_DIR)
}

function cleanUp(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

describe("GoalStore", () => {
  beforeEach(() => setPromptLocale("en"));
  let store: GoalStore
  let threadId: string

  beforeEach(() => {
    cleanUp()
    mkdirSync(TEST_DIR, { recursive: true })
    store = makeStore()
    threadId = randomUUID()
  })

  afterEach(() => {
    cleanUp()
  })

  it("createGoal creates a new goal with active status", () => {
    const goal = store.createGoal(threadId, "Fix all bugs")
    expect(goal.threadId).toBe(threadId)
    expect(goal.objective).toBe("Fix all bugs")
    expect(goal.status).toBe("active")
    expect(goal.tokensUsed).toBe(0)
    expect(goal.timeUsedSeconds).toBe(0)
    expect(goal.goalId).toBeDefined()
  })

  it("createGoal with tokenBudget", () => {
    const goal = store.createGoal(threadId, "Refactor", 50000)
    expect(goal.tokenBudget).toBe(50000)
  })

  it("createGoal rejects when existing goal is not in terminal status", () => {
    store.createGoal(threadId, "First")
    expect(() => store.createGoal(threadId, "Second")).toThrow(/Cannot create goal/)
  })

  it("createGoal allows when existing goal is complete", () => {
    const g1 = store.createGoal(threadId, "First")
    store.updateGoal(threadId, { status: "complete" })
    const g2 = store.createGoal(threadId, "Second")
    expect(g2.goalId).not.toBe(g1.goalId)
    expect(g2.objective).toBe("Second")
  })

  it("createGoal allows when existing goal is budget_limited", () => {
    store.createGoal(threadId, "First")
    store.systemSetStatus(threadId, "budget_limited")
    const g2 = store.createGoal(threadId, "Second")
    expect(g2.objective).toBe("Second")
  })

  it("getGoal returns null for non-existent thread", () => {
    expect(store.getGoal("nonexistent")).toBeNull()
  })

  it("getGoal returns the goal after creation", () => {
    const created = store.createGoal(threadId, "Test")
    const fetched = store.getGoal(threadId)
    expect(fetched).not.toBeNull()
    expect(fetched!.goalId).toBe(created.goalId)
    expect(fetched!.objective).toBe("Test")
  })

  it("replaceGoal creates a new goal regardless of existing status", () => {
    store.createGoal(threadId, "First")
    const replaced = store.replaceGoal(threadId, "Replaced")
    expect(replaced.objective).toBe("Replaced")
    expect(replaced.status).toBe("active")
  })

  it("updateGoal with complete status", () => {
    const goal = store.createGoal(threadId, "Test")
    const updated = store.updateGoal(threadId, { status: "complete" })
    expect(updated.status).toBe("complete")
  })

  it("updateGoal with blocked status", () => {
    store.createGoal(threadId, "Test")
    const updated = store.updateGoal(threadId, { status: "blocked" })
    expect(updated.status).toBe("blocked")
  })

  it("updateGoal rejects invalid status: active", () => {
    store.createGoal(threadId, "Test")
    expect(() => store.updateGoal(threadId, { status: "active" as any })).toThrow(
      /updateGoal only accepts/,
    )
  })

  it("updateGoal rejects invalid status: paused", () => {
    store.createGoal(threadId, "Test")
    expect(() => store.updateGoal(threadId, { status: "paused" as any })).toThrow(
      /updateGoal only accepts/,
    )
  })

  it("updateGoal rejects invalid status: usage_limited", () => {
    store.createGoal(threadId, "Test")
    expect(() => store.updateGoal(threadId, { status: "usage_limited" as any })).toThrow(
      /updateGoal only accepts/,
    )
  })

  it("updateGoal rejects invalid status: budget_limited", () => {
    store.createGoal(threadId, "Test")
    expect(() => store.updateGoal(threadId, { status: "budget_limited" as any })).toThrow(
      /updateGoal only accepts/,
    )
  })

  it("updateGoal only accepts complete or blocked", () => {
    store.createGoal(threadId, "Test")
    expect(() => store.updateGoal(threadId, { status: "invalid" as any })).toThrow(
      /updateGoal only accepts/,
    )
  })

  it("updateGoal with expectedGoalId matching", () => {
    const goal = store.createGoal(threadId, "Test")
    const updated = store.updateGoal(threadId, { status: "complete", expectedGoalId: goal.goalId })
    expect(updated.status).toBe("complete")
  })

  it("updateGoal rejects expectedGoalId mismatch", () => {
    store.createGoal(threadId, "Test")
    expect(() =>
      store.updateGoal(threadId, { status: "complete", expectedGoalId: "wrong-id" }),
    ).toThrow(/expectedGoalId mismatch/)
  })

  it("updateGoal can change objective", () => {
    store.createGoal(threadId, "Old")
    const updated = store.updateGoal(threadId, { objective: "New" })
    expect(updated.objective).toBe("New")
  })

  it("clearGoal deletes the goal file", () => {
    store.createGoal(threadId, "Test")
    expect(store.getGoal(threadId)).not.toBeNull()
    store.clearGoal(threadId)
    expect(store.getGoal(threadId)).toBeNull()
  })

  it("clearGoal returns false for non-existent thread", () => {
    expect(store.clearGoal("nonexistent")).toBe(false)
  })

  it("setTokenBudget updates budget on active goal", () => {
    store.createGoal(threadId, "Test")
    const updated = store.setTokenBudget(threadId, 50000)
    expect(updated.tokenBudget).toBe(50000)
    const readBack = store.getGoal(threadId)
    expect(readBack!.tokenBudget).toBe(50000)
  })

  it("setTokenBudget clears budget when undefined", () => {
    store.createGoal(threadId, "Test", 50000)
    store.setTokenBudget(threadId, undefined)
    const readBack = store.getGoal(threadId)
    expect(readBack!.tokenBudget).toBeUndefined()
  })

  it("accountProgress accumulates tokens and time", () => {
    store.createGoal(threadId, "Test")
    const updated = store.accountProgress(threadId, 1000, 30)
    expect(updated.tokensUsed).toBe(1000)
    expect(updated.timeUsedSeconds).toBe(30)

    const updated2 = store.accountProgress(threadId, 500, 10)
    expect(updated2.tokensUsed).toBe(1500)
    expect(updated2.timeUsedSeconds).toBe(40)
  })

  it("accountProgress sets budget_limited when tokenBudget reached", () => {
    store.createGoal(threadId, "Test", 2000)
    const updated = store.accountProgress(threadId, 2500, 10)
    expect(updated.status).toBe("budget_limited")
    expect(updated.tokensUsed).toBe(2500)
  })

  it("accountProgress does not set budget_limited when no tokenBudget set", () => {
    store.createGoal(threadId, "Test")
    const updated = store.accountProgress(threadId, 999999, 999)
    expect(updated.status).toBe("active")
  })

  it("systemSetStatus allows any status", () => {
    store.createGoal(threadId, "Test")
    const paused = store.systemSetStatus(threadId, "paused")
    expect(paused.status).toBe("paused")

    const limited = store.systemSetStatus(threadId, "usage_limited")
    expect(limited.status).toBe("usage_limited")
  })

  it("persists to disk and survives store recreation", () => {
    store.createGoal(threadId, "Persist test", 10000)
    store.accountProgress(threadId, 500, 5)

    const store2 = makeStore()
    const loaded = store2.getGoal(threadId)
    expect(loaded).not.toBeNull()
    expect(loaded!.objective).toBe("Persist test")
    expect(loaded!.tokensUsed).toBe(500)
    expect(loaded!.timeUsedSeconds).toBe(5)
    expect(loaded!.tokenBudget).toBe(10000)
  })
})
