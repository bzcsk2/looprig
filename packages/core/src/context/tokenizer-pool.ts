import { Worker } from "node:worker_threads"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { estimateTokens as fallbackEstimate } from "./token-estimator.js"
import type { ChatMessage } from "../types.js"
import { noopRuntimeLogger, type RuntimeLogger } from "../runtime-logger.js"

type TaskId = number

interface TaskEntry {
  resolve: (value: number) => void
  reject: (reason: unknown) => void
  messages: ChatMessage[]
}

export interface TokenizerPoolDiagnostics {
  healthy: boolean
  pendingTasks: number
  fallbackCount: number
  timeoutCount: number
  workerErrorCount: number
  lastFallbackReason?: string
}

export class TokenizerPool {
  private worker?: Worker
  private tasks = new Map<TaskId, TaskEntry>()
  private nextId = 1
  private healthy = true
  private consecutiveTimeouts = 0
  private fallbackCount = 0
  private timeoutCount = 0
  private workerErrorCount = 0
  private lastFallbackReason?: string
  private logger: RuntimeLogger

  constructor(logger: RuntimeLogger = noopRuntimeLogger) {
    this.logger = logger
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url))
      const workerPath = resolve(__dirname, "tokenizer-worker.js")
      this.worker = new Worker(workerPath)
      this.worker.on("message", (msg: { id: TaskId; result: number }) => {
        this.consecutiveTimeouts = 0
        const entry = this.tasks.get(msg.id)
        if (entry) {
          this.tasks.delete(msg.id)
          entry.resolve(msg.result)
        }
      })
      this.worker.on("error", (error) => {
        this.healthy = false
        this.workerErrorCount++
        this.resolvePendingWithFallback("worker_error")
        this.logFallback("worker_error", error)
      })
      this.worker.on("exit", (code) => {
        if (code !== 0) {
          this.healthy = false
          this.workerErrorCount++
          this.resolvePendingWithFallback("worker_exit")
          this.logFallback("worker_exit", undefined, { code })
        }
      })
    } catch (error) {
      this.healthy = false
      this.workerErrorCount++
      this.logFallback("worker_init_failed", error)
    }
  }

  async estimate(messages: ChatMessage[]): Promise<number> {
    if (!this.healthy || !this.worker) {
      this.fallbackCount++
      this.lastFallbackReason = "unhealthy"
      return fallbackEstimate(messages)
    }

    const id = this.nextId++
    return new Promise<number>((resolve, reject) => {
      this.tasks.set(id, { resolve, reject, messages })
      this.worker!.postMessage({ id, messages })
      // timeout guard: if worker hangs, fallback to main thread
      setTimeout(() => {
        const entry = this.tasks.get(id)
        if (entry) {
          this.tasks.delete(id)
          this.consecutiveTimeouts++
          this.timeoutCount++
          this.fallbackCount++
          this.lastFallbackReason = "timeout"
          if (this.consecutiveTimeouts >= 3) this.healthy = false
          this.logFallback("timeout", undefined, { consecutiveTimeouts: this.consecutiveTimeouts })
          resolve(fallbackEstimate(entry.messages))
        }
      }, 5_000)
    })
  }

  getDiagnostics(): TokenizerPoolDiagnostics {
    return {
      healthy: this.healthy,
      pendingTasks: this.tasks.size,
      fallbackCount: this.fallbackCount,
      timeoutCount: this.timeoutCount,
      workerErrorCount: this.workerErrorCount,
      lastFallbackReason: this.lastFallbackReason,
    }
  }

  async shutdown(): Promise<void> {
    for (const [, entry] of this.tasks) {
      entry.reject(new Error("Tokenizer pool shut down"))
    }
    this.tasks.clear()
    if (this.worker) {
      try { await this.worker.terminate() } catch {}
      this.worker = undefined
    }
    this.healthy = false
  }

  private resolvePendingWithFallback(reason: string): void {
    for (const [id, entry] of this.tasks) {
      this.tasks.delete(id)
      this.fallbackCount++
      this.lastFallbackReason = reason
      entry.resolve(fallbackEstimate(entry.messages))
    }
  }

  private logFallback(reason: string, error?: unknown, metadata: Record<string, unknown> = {}): void {
    if (!this.logger.isEnabled("warn")) return
    this.logger.warn("fallback.tokenizer", {
      reason,
      pendingTasks: this.tasks.size,
      errorClass: error instanceof Error ? error.name : undefined,
      ...metadata,
    })
  }
}
