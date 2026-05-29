import type { ChatMessage } from "../types.js"
import { cloneChatMessage, cloneChatMessages } from "./message.js"

/**
 * AppendOnlyLog — 对话历史（只追加区域）
 *
 * 三区域上下文分区的第二部分。
 * 参考 Reasonix (github.com/bczsk2/reasonix-core) 的
 * AppendOnlyHistory 设计：所有 message 只追加不修改，
 * 保证 ImmutablePrefix 字节稳定性不被破坏。
 *
 * 参考 Reasonix 源码: src/context/AppendOnlyHistory.ts
 */
export class AppendOnlyLog {
  // 内部存储：追加式消息列表，按对话顺序排列
  private entries: ChatMessage[] = []

  // 追加单条消息到日志末尾
  append(message: ChatMessage): void {
    this.entries.push(cloneChatMessage(message))
  }

  appendMany(messages: ChatMessage[]): void {
    this.entries.push(...cloneChatMessages(messages))
  }

  // 获取日志消息的只读视图
  get messages(): readonly ChatMessage[] {
    return cloneChatMessages(this.entries)
  }

  // 获取当前日志长度（消息条数）
  get length(): number {
    return this.entries.length
  }

  // 清空日志（通常在重置会话时使用）
  clear(): void {
    this.entries = []
  }
}
