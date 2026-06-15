import type { ChatMessage, AgentRole } from '@deepreef/core';

/** 工具调用在 transcript / timeline 中的运行态快照 */
export interface ToolStatus {
  key: string;
  name: string;
  status: 'running' | 'done' | 'error';
  args: Record<string, unknown>;
  output: string;
  startedAt: number;
  elapsedMs?: number;
}

/**
 * 单条 transcript 条目（与 UI `TimelineItem` 同构）。
 * `role` 标记该条目产自哪个角色（worker / supervisor），供主屏时间线
 * 显示角色名标签；用户消息可省略（由 `message.role === 'user'` 判定）。
 */
export type TranscriptEntry =
  | { id: string; kind: 'message'; message: ChatMessage; role?: AgentRole }
  | { id: string; kind: 'assistant_text'; roundId: string; text: string; isStreaming: boolean; startTs: number; role?: AgentRole }
  | { id: string; kind: 'reasoning'; roundId: string; text: string; isStreaming: boolean; startTs: number; role?: AgentRole }
  | { id: string; kind: 'tool'; roundId: string; tool: ToolStatus; role?: AgentRole };

/** @deprecated 与 `TranscriptEntry` 同构，保留以兼容现有 UI 导入 */
export type TimelineItem = TranscriptEntry;

/** 流式 part 指针（messageId + partId） */
export interface PartRef {
  messageId: string;
  partId: string;
}

export interface TranscriptSnapshot {
  order: readonly string[];
  entries: Readonly<Record<string, TranscriptEntry>>;
  version: number;
}
