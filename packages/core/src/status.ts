import type { SessionStats } from "./interface.js"
import type { SessionWriterStatus } from "./session.js"

export interface EngineStatusSnapshot {
  sessionId: string
  context: {
    prefixTokens: number
    logTokens: number
    scratchTokens: number
    totalTokens: number
    window: number
    ratio: number
  }
  stats: SessionStats
  currentAgent: string
  isSubmitting: boolean
  /** FG-60-R: 会话写入器 best-effort 状态 */
  sessionWriter?: SessionWriterStatus
  timestamp: string
}
