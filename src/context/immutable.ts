// 导入 Node.js 加密模块，用于计算 prefix 内容的 SHA-256 哈希
import { createHash } from "node:crypto"
import type { ChatMessage } from "../types.js"

/**
 * ImmutablePrefix — 系统提示词（字节稳定区域）
 *
 * 三区域上下文分区的第一部分。
 * 设计受 Reasonix (github.com/bczsk2/reasonix-core) 项目的
 * DeepSeek prefix-cache 优化启发：将系统提示词固定在请求前缀，
 * 确保每轮请求的初始 N 个 token 字节一致，使 DeepSeek V4 的
 * prefix-cache (cache hit tokens) 可以跨轮命中。
 *
 * 参考 Reasonix 源码: src/context/PrefixCacheManager.ts
 */
export class ImmutablePrefix {
  // 内部存储：前缀消息列表（通常只有一条 system 消息）
  private prefix: ChatMessage[] = []
  // 前缀内容的 SHA-256 哈希值，用于快速比较和缓存标识
  private hash: string = ""

  // 构建系统提示词：接受字符串，包装为 system 角色消息，并计算哈希
  build(systemPrompt: string): void {
    this.prefix = [{ role: "system", content: systemPrompt }]
    this.hash = this.computeHash(this.prefix)
  }

  // 获取前缀消息的只读视图
  get messages(): readonly ChatMessage[] {
    return this.prefix
  }

  // 获取前缀的缓存键（SHA-256 哈希），用于验证跨轮字节一致性
  get cacheKey(): string {
    return this.hash
  }

  // 计算消息列表的 SHA-256 哈希值
  // 将每条消息的 role 和 content 拼接后哈希，确保字节级可比较
  private computeHash(msgs: ChatMessage[]): string {
    const h = createHash("sha256")
    for (const m of msgs) {
      h.update(m.role)
      h.update(m.content ?? "")
    }
    return h.digest("hex")
  }
}
