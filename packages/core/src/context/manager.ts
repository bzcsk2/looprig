import type { ChatMessage } from "../types.js"
import { AppendOnlyLog } from "./append-log.js"
import { ImmutablePrefix } from "./immutable.js"
import { VolatileScratch } from "./scratch.js"
import { getFoldDecision, estimateTokens } from "./token-estimator.js"
import { TokenizerPool } from "./tokenizer-pool.js"
import type { FoldDecision } from "./token-estimator.js"

export interface ContextBudget {
  prefixTokens: number
  logTokens: number
  scratchTokens: number
  totalTokens: number
  window: number
  ratio: number
}

export class ContextManager {
  readonly prefix: ImmutablePrefix
  readonly log: AppendOnlyLog
  readonly scratch: VolatileScratch
  private maxRounds: number

  private tokenizer: TokenizerPool

  constructor(maxRounds = 20, private contextWindow = 128_000) {
    this.prefix = new ImmutablePrefix()
    this.log = new AppendOnlyLog()
    this.scratch = new VolatileScratch()
    this.maxRounds = maxRounds
    this.tokenizer = new TokenizerPool()
  }

  getContextWindow(): number { return this.contextWindow }

  getMaxRounds(): number { return this.maxRounds }

  updateContextWindow(window: number): void {
    this.contextWindow = window
  }

  async estimateTokens(): Promise<number> {
    return this.tokenizer.estimate(this.buildMessages())
  }

  async getBudget(): Promise<ContextBudget> {
    const prefixTokens = estimateTokens([...this.prefix.messages])
    const log = this.prepareLog()
    const logTokens = estimateTokens(log)
    const scratchTokens = estimateTokens([...this.scratch.messages])
    const totalTokens = prefixTokens + logTokens + scratchTokens
    return { prefixTokens, logTokens, scratchTokens, totalTokens, window: this.contextWindow, ratio: totalTokens / this.contextWindow }
  }

  async getFoldDecision(): Promise<FoldDecision> {
    const used = await this.estimateTokens()
    return getFoldDecision(used, this.contextWindow)
  }

  shutdown(): void {
    this.tokenizer.shutdown()
  }

  private prepareLog(): ChatMessage[] {
    let log = [...this.log.messages]
    if (this.maxRounds > 0) {
      log = this.truncateByRounds(log)
    }
    log = this.truncateToBudget(log)
    return log
  }

  buildMessages(): ChatMessage[] {
    const prefixMsgs = this.prefix.messages
    const scratchMsgs = this.scratch.messages

    const log = this.prepareLog()

    // CL-30: Check prefix alone exceeds window — configuration error
    const prefixTokens = estimateTokens([...prefixMsgs])
    if (prefixTokens > this.contextWindow) {
      throw new Error(`Context budget exceeded: prefix alone (${prefixTokens}t) exceeds window (${this.contextWindow}t)`)
    }

    const scratchTokens = estimateTokens([...scratchMsgs])
    if (scratchTokens > this.contextWindow) {
      throw new Error(`Context budget exceeded: scratch alone (${scratchTokens}t) exceeds window (${this.contextWindow}t)`)
    }

    // CL-30: Final warning — if total still over budget after truncation,
    // fold decision in loop.ts will force a fold on next turn
    // (we don't throw here because the loop handles fold signals externally)

    return [
      ...prefixMsgs,
      ...log,
      ...scratchMsgs,
    ]
  }

  private truncateByRounds(log: ChatMessage[]): ChatMessage[] {
    const userIdx: number[] = []
    for (let i = 0; i < log.length; i++) {
      if (log[i].role === "user") userIdx.push(i)
    }
    if (userIdx.length <= this.maxRounds) return log

    let cutFrom = userIdx[userIdx.length - this.maxRounds]
    for (let i = cutFrom; i < log.length; i++) {
      if (log[i].role === "tool" && (i === 0 || log[i - 1].role !== "assistant")) {
        while (i < log.length && log[i].role !== "user") i++
        cutFrom = i
        break
      }
    }
    return log.slice(cutFrom)
  }

  private truncateToBudget(log: ChatMessage[]): ChatMessage[] {
    if (log.length === 0) return log

    const baselineTokens = estimateTokens([...this.prefix.messages, ...this.scratch.messages])

    let current = [...log]
    let estimated = estimateTokens(current)

    while (estimated + baselineTokens > this.contextWindow && current.length > 0) {
      const firstUserIdx = current.findIndex(m => m.role === "user")
      if (firstUserIdx < 0) {
        // CL-30: No user messages in log — remove oldest tool round instead
        const firstToolIdx = current.findIndex(m => m.role === "tool")
        if (firstToolIdx < 0) break // nothing to remove
        const roundEnd = current.findIndex((m, i) => i > firstToolIdx && (m.role === "assistant" || m.role === "tool"))
        current = roundEnd < 0 ? current.slice(firstToolIdx + 1) : current.slice(roundEnd)
        estimated = estimateTokens(current)
        continue
      }

      let roundEnd = current.length
      for (let i = firstUserIdx + 1; i < current.length; i++) {
        if (current[i].role === "user") {
          roundEnd = i
          break
        }
        if (current[i].role === "tool" && (i + 1 >= current.length || current[i + 1].role === "user")) {
          roundEnd = i + 1
          break
        }
      }

      current = current.slice(roundEnd)
      estimated = estimateTokens(current)
    }

    return current
  }

  startTurn(): void {
    this.scratch.reset()
  }
}
