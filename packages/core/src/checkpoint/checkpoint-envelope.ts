/**
 * Checkpoint v1 信封 — 与 `.deepreef/sessions/*.checkpoint.json` 兼容的最小壳。
 */

import type { StopReason } from "./runtime-checkpoint.js"

/** v1 checkpoint 信封（Deepreef 会话级） */
export interface SessionCheckpointEnvelope {
  version: 1
  sessionId?: string
  status?: "running" | "completed" | "failed" | "aborted"
  userGoal?: string
  messageCount?: number
  lastStopReason?: StopReason
  createdAt?: string
  updatedAt?: string
}

/** 构造最小 running 占位信封（v2 首次落盘时使用） */
export function buildMinimalCheckpointEnvelope(sessionId = "default"): SessionCheckpointEnvelope {
  const now = new Date().toISOString()
  return {
    version: 1,
    sessionId,
    status: "running",
    userGoal: "",
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}
