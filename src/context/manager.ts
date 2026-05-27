import type { ChatMessage } from "../types.js"
import { AppendOnlyLog } from "./append-log.js"
import { ImmutablePrefix } from "./immutable.js"
import { VolatileScratch } from "./scratch.js"

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

  constructor() {
    this.prefix = new ImmutablePrefix()
    this.log = new AppendOnlyLog()
    this.scratch = new VolatileScratch()
  }

  /** 组装完整的 messages 数组：prefix + log + scratch */
  buildMessages(): ChatMessage[] {
    const msgs: ChatMessage[] = [
      ...this.prefix.messages,
      ...this.log.messages,
      ...this.scratch.messages,
    ]
    return msgs
  }

  /** 新轮次开始前调用：清空 scratch 暂存区 */
  startTurn(): void {
    this.scratch.reset()
  }
}
