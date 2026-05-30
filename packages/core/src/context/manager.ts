import type { ChatMessage } from "../types.js"
import { AppendOnlyLog } from "./append-log.js"
import { ImmutablePrefix } from "./immutable.js"
import { VolatileScratch } from "./scratch.js"
import { getFoldDecision } from "./token-estimator.js"
import { TokenizerPool } from "./tokenizer-pool.js"
import type { FoldDecision } from "./token-estimator.js"

/**
 * ContextManager — 三区域上下文管理器
 *
 * 核心价值：将 DeepSeek V4 的 prefix-cache 利用率最大化。
 *
 * 组装策略：
 *   1. ImmutablePrefix — 系统提示词（字节稳定 → prefix-cache 命中）
 *   2. AppendOnlyLog   — 历史对话（只追加 → 前缀稳定性保持）
 *   3. VolatileScratch — 每轮临时状态（每次轮清空）
 *
 * 这种布局直接将三区域分区概念与 DeepSeek 的 prefix-cache 特性对齐：
 * 前 N 个 token 字节一致时，API 端自动返回 cache hit tokens，
 * 大幅降低推理成本和延迟。
 *
 * 参考 Reasonix 源码: src/context/ContextManager.ts
 */
export class ContextManager {
  // 区域一：不可变前缀，存放系统提示词
  readonly prefix: ImmutablePrefix
  // 区域二：只追加日志，存放完整对话历史
  readonly log: AppendOnlyLog
  // 区域三：易失暂存区，每轮清空
  readonly scratch: VolatileScratch
  // 上下文截断阈值：保留的最大对话轮数（按 user 消息计数），0 表示不截断
  private maxRounds: number

  private tokenizer: TokenizerPool

  constructor(maxRounds = 20, private contextWindow = 128_000) {
    this.prefix = new ImmutablePrefix()
    this.log = new AppendOnlyLog()
    this.scratch = new VolatileScratch()
    this.maxRounds = maxRounds
    this.tokenizer = new TokenizerPool()
  }

  updateContextWindow(window: number): void {
    this.contextWindow = window
  }

  async estimateTokens(): Promise<number> {
    return this.tokenizer.estimate(this.buildMessages())
  }

  async getFoldDecision(): Promise<FoldDecision> {
    const used = await this.estimateTokens()
    return getFoldDecision(used, this.contextWindow)
  }

  /** 释放 Worker 资源 */
  shutdown(): void {
    this.tokenizer.shutdown()
  }

  /** 组装完整的 messages 数组：prefix + log（截断后）+ scratch */
  buildMessages(): ChatMessage[] {
    let log = [...this.log.messages]

    // 截断：保留最近 maxRounds 轮对话（按 user 消息计数）
    if (this.maxRounds > 0) {
      const userIdx: number[] = []
      for (let i = 0; i < log.length; i++) {
        if (log[i].role === "user") userIdx.push(i)
      }
      if (userIdx.length > this.maxRounds) {
        let cutFrom = userIdx[userIdx.length - this.maxRounds]
        // 向前扫描，确保不切断 tool 消息组（孤立 tool 消息会导致 API 400）
        for (let i = cutFrom; i < log.length; i++) {
          if (log[i].role === "tool" && (i === 0 || log[i - 1].role !== "assistant")) {
            while (i < log.length && log[i].role !== "user") i++
            cutFrom = i
            break
          }
        }
        log = log.slice(cutFrom)
      }
    }

    return [
      ...this.prefix.messages,
      ...log,
      ...this.scratch.messages,
    ]
  }

  /** 新轮次开始前调用：清空 scratch 暂存区 */
  startTurn(): void {
    this.scratch.reset()
  }
}
