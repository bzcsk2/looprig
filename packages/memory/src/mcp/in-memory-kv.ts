import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export class InMemoryKV {
  private store = new Map<string, Map<string, unknown>>();
  private lastPersistError: string | null = null;

  constructor(private persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      try {
        const data = JSON.parse(readFileSync(persistPath, "utf-8"));
        for (const [scope, entries] of Object.entries(data)) {
          const map = new Map<string, unknown>();
          for (const [key, value] of Object.entries(
            entries as Record<string, unknown>,
          )) {
            map.set(key, value);
          }
          this.store.set(scope, map);
        }
      } catch {
        // start fresh
      }
    }
  }

  async get<T = unknown>(scope: string, key: string): Promise<T | null> {
    return (this.store.get(scope)?.get(key) as T) ?? null;
  }

  async set<T = unknown>(scope: string, key: string, data: T): Promise<T> {
    if (!this.store.has(scope)) this.store.set(scope, new Map());
    this.store.get(scope)!.set(key, data);
    this.persist();
    return data;
  }

  async delete(scope: string, key: string): Promise<void> {
    this.store.get(scope)?.delete(key);
    this.persist();
  }

  async list<T = unknown>(scope: string): Promise<T[]> {
    const entries = this.store.get(scope);
    return entries ? (Array.from(entries.values()) as T[]) : [];
  }

  getLastPersistError(): string | null {
    return this.lastPersistError;
  }

  persist(): void {
    if (!this.persistPath) return;
    this.lastPersistError = null;
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data: Record<string, Record<string, unknown>> = {};
      for (const [scope, entries] of this.store) {
        data[scope] = Object.fromEntries(entries);
      }
      const tmpPath = this.persistPath + ".covalo_tmp_" + randomUUID();
      writeFileSync(tmpPath, JSON.stringify(data), "utf-8");
      renameSync(tmpPath, this.persistPath);
    } catch (err) {
      this.lastPersistError = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[@agentmemory/mcp] Persist failed: ${this.lastPersistError}\n`,
      );
    }
  }
}
