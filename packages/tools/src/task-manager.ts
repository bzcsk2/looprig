import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

export interface TaskItem {
  id: string
  content: string
  status: string
  priority: string
  createdAt: number
  updatedAt: number
  tags?: string[]
}

function generateId(): string {
  return crypto.randomUUID()
}

export class TaskManager {
  private filePath: string
  private tasks: TaskItem[] = []

  constructor(baseDir?: string) {
    const dir = baseDir ?? process.cwd()
    this.filePath = resolve(dir, ".deepicode", "tasks.json")
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.tasks = []
      return
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8")
      const parsed = JSON.parse(raw)
      this.tasks = Array.isArray(parsed) ? parsed : []
    } catch {
      this.tasks = []
    }
  }

  private save(): void {
    const dir = resolve(this.filePath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), "utf-8")
  }

  list(): TaskItem[] {
    this.load()
    return [...this.tasks]
  }

  get(id: string): TaskItem | undefined {
    this.load()
    return this.tasks.find((t) => t.id === id)
  }

  create(item: Omit<TaskItem, "id" | "createdAt" | "updatedAt">): TaskItem {
    this.load()
    const task: TaskItem = {
      ...item,
      id: generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.tasks.push(task)
    this.save()
    return task
  }

  update(id: string, partial: Partial<Omit<TaskItem, "id" | "createdAt">>): boolean {
    this.load()
    const idx = this.tasks.findIndex((t) => t.id === id)
    if (idx === -1) return false
    this.tasks[idx] = { ...this.tasks[idx], ...partial, updatedAt: Date.now() }
    this.save()
    return true
  }

  stop(id: string): boolean {
    return this.update(id, { status: "cancelled" })
  }
}
