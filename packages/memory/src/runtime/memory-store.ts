import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"

export interface MemoryStoreEntry<T = unknown> {
  key: string
  value: T
  scope: string
  updatedAt: string
}

export interface MemoryUpdateOp {
  op: "set" | "delete" | "append"
  path: string
  value?: unknown
}

export class MemoryStore {
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? resolve(homedir(), ".covalo", "memory")
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  private validatePathComponent(name: string, label: string): void {
    if (name.includes("/") || name.includes("\\") || name === ".." || name.includes("..")) {
      throw new Error(`Invalid ${label}: ${name}`)
    }
  }

  private scopeDir(scope: string): string {
    this.validatePathComponent(scope, "scope")
    const d = resolve(this.baseDir, "state", scope)
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
    return d
  }

  private filePath(scope: string, key: string): string {
    this.validatePathComponent(key, "key")
    return resolve(this.scopeDir(scope), `${key}.json`)
  }

  private validateAccess(scope: string, key: string): void {
    this.validatePathComponent(scope, "scope")
    this.validatePathComponent(key, "key")
  }

  async get<T = unknown>(scope: string, key: string): Promise<T | null> {
    this.validateAccess(scope, key)
    try {
      const raw = readFileSync(this.filePath(scope, key), "utf8")
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async set<T = unknown>(scope: string, key: string, value: T): Promise<T> {
    this.validateAccess(scope, key)
    const path = this.filePath(scope, key)
    const data = JSON.stringify(value, null, 2)
    const tmp = path + ".tmp"
    writeFileSync(tmp, data, "utf8")
    try {
      const { renameSync } = await import("node:fs")
      renameSync(tmp, path)
    } catch {
      writeFileSync(path, data, "utf8")
      try { unlinkSync(tmp) } catch {}
    }
    return value
  }

  async update<T = unknown>(scope: string, key: string, ops: MemoryUpdateOp[]): Promise<T> {
    this.validateAccess(scope, key)
    let current = await this.get<Record<string, unknown>>(scope, key) ?? {} as Record<string, unknown>
    for (const op of ops) {
      if (op.op === "set") {
        this.setNested(current, op.path, op.value)
      } else if (op.op === "delete") {
        this.deleteNested(current, op.path)
      } else if (op.op === "append") {
        const arr = this.getNested(current, op.path) as unknown[]
        if (!Array.isArray(arr)) {
          this.setNested(current, op.path, [op.value])
        } else {
          arr.push(op.value)
        }
      }
    }
    return this.set(scope, key, current) as Promise<T>
  }

  async delete(scope: string, key: string): Promise<void> {
    this.validateAccess(scope, key)
    try {
      unlinkSync(this.filePath(scope, key))
    } catch {
      // Already deleted
    }
  }

  async list<T = unknown>(scope: string): Promise<T[]> {
    this.validatePathComponent(scope, "scope")
    const dir = this.scopeDir(scope)
    try {
      const files = readdirSync(dir).filter(f => f.endsWith(".json"))
      const results: T[] = []
      for (const f of files) {
        try {
          const raw = readFileSync(join(dir, f), "utf8")
          results.push(JSON.parse(raw) as T)
        } catch {
          // Skip corrupted entries
        }
      }
      return results
    } catch {
      return []
    }
  }

  async close(): Promise<void> {
    // No-op for file-based store
  }

  private setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".")
    let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {}
      }
      current = current[parts[i]] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  private deleteNested(obj: Record<string, unknown>, path: string): void {
    const parts = path.split(".")
    let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) return
      current = current[parts[i]] as Record<string, unknown>
    }
    delete current[parts[parts.length - 1]]
  }

  private getNested(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".")
    let current: unknown = obj
    for (const part of parts) {
      if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }
    return current
  }
}
