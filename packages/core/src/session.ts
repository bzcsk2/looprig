import { mkdir, appendFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { ChatMessage } from "./types.js"

export interface SessionRecord {
  ts: number
  type: "event" | "messages" | "stats"
  payload: unknown
}

export class SegmentedLog {
  archive: ChatMessage[] = []
  active: ChatMessage[] = []

  append(messages: ChatMessage[]): void {
    this.active.push(...messages)
  }

  snapshot(): ChatMessage[] {
    return [...this.archive, ...this.active]
  }
}

export class AsyncSessionWriter {
  private path: string
  private queue: string[] = []
  private flushing = false

  constructor(path: string) {
    this.path = path
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
  }

  enqueue(record: SessionRecord): void {
    this.queue.push(JSON.stringify(record) + "\n")
    void this.flushSoon()
  }

  private async flushSoon(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.queue.length > 0) {
        const chunk = this.queue.splice(0, 50).join("")
        await appendFile(this.path, chunk, "utf-8")
      }
    } catch {
      // best-effort: swallow write errors silently
    } finally {
      this.flushing = false
    }
  }
}

