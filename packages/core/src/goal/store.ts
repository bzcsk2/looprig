import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { ThreadGoal, GoalStatus } from "./types.js"

const TERMINAL_STATUSES: GoalStatus[] = ["complete", "budget_limited"]
const SYSTEM_CONTROLLED_STATUSES: GoalStatus[] = ["paused", "usage_limited", "budget_limited", "active"]
const MODEL_ALLOWED_STATUSES: GoalStatus[] = ["complete", "blocked"]

export class GoalStore {
  private basePath: string

  constructor(basePath?: string) {
    this.basePath = basePath ?? resolve(process.cwd(), ".covalo", "sessions")
  }

  private goalPath(threadId: string): string {
    return resolve(this.basePath, threadId, "goal.json")
  }

  getGoal(threadId: string): ThreadGoal | null {
    const path = this.goalPath(threadId)
    if (!existsSync(path)) return null
    try {
      const raw = readFileSync(path, "utf-8")
      return JSON.parse(raw) as ThreadGoal
    } catch {
      return null
    }
  }

  createGoal(threadId: string, objective: string, tokenBudget?: number): ThreadGoal {
    const existing = this.getGoal(threadId)
    if (existing && !TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(
        `Cannot create goal: existing goal ${existing.goalId} is ${existing.status}. Use replaceGoal() to replace.`,
      )
    }

    const goal: ThreadGoal = {
      threadId,
      goalId: randomUUID(),
      objective,
      status: "active",
      tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.writeGoal(goal)
    return goal
  }

  replaceGoal(threadId: string, objective: string, tokenBudget?: number): ThreadGoal {
    const goal: ThreadGoal = {
      threadId,
      goalId: randomUUID(),
      objective,
      status: "active",
      tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.writeGoal(goal)
    return goal
  }

  updateGoal(
    threadId: string,
    fields: { status?: GoalStatus; objective?: string; expectedGoalId?: string },
  ): ThreadGoal {
    const goal = this.getGoal(threadId)
    if (!goal) throw new Error(`No goal found for thread ${threadId}`)

    if (fields.expectedGoalId !== undefined && fields.expectedGoalId !== goal.goalId) {
      throw new Error(
        `expectedGoalId mismatch: expected ${fields.expectedGoalId}, actual ${goal.goalId}`,
      )
    }

    if (fields.status !== undefined) {
      if (!MODEL_ALLOWED_STATUSES.includes(fields.status)) {
        throw new Error(`updateGoal only accepts "complete" or "blocked"`)
      }
    }

    if (fields.objective !== undefined) {
      goal.objective = fields.objective
    }
    if (fields.status !== undefined) {
      goal.status = fields.status
    }
    goal.updatedAt = Date.now()

    this.writeGoal(goal)
    return goal
  }

  clearGoal(threadId: string): boolean {
    const path = this.goalPath(threadId)
    if (!existsSync(path)) return false
    rmSync(path, { force: true })
    return true
  }

  setTokenBudget(threadId: string, tokenBudget: number | undefined): ThreadGoal {
    const goal = this.getGoal(threadId)
    if (!goal) throw new Error(`No goal found for thread ${threadId}`)
    goal.tokenBudget = tokenBudget
    goal.updatedAt = Date.now()
    this.writeGoal(goal)
    return goal
  }

  accountProgress(threadId: string, tokensUsed: number, timeUsedSeconds: number): ThreadGoal {
    const goal = this.getGoal(threadId)
    if (!goal) throw new Error(`No goal found for thread ${threadId}`)

    goal.tokensUsed += tokensUsed
    goal.timeUsedSeconds += timeUsedSeconds
    goal.updatedAt = Date.now()

    if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) {
      goal.status = "budget_limited"
    }

    this.writeGoal(goal)
    return goal
  }

  systemSetStatus(threadId: string, status: GoalStatus): ThreadGoal {
    const goal = this.getGoal(threadId)
    if (!goal) throw new Error(`No goal found for thread ${threadId}`)
    goal.status = status
    goal.updatedAt = Date.now()
    this.writeGoal(goal)
    return goal
  }

  private writeGoal(goal: ThreadGoal): void {
    const path = this.goalPath(goal.threadId)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(goal, null, 2), "utf-8")
  }
}
