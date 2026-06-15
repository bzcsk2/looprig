import type { TimelineItem } from '../bridge.js';
import type { TranscriptStore } from './transcript-store.js';

/**
 * 比较条目内容是否一致（用于结构共享缓存）。
 */
function timelineEntryEquals(a: TimelineItem, b: TimelineItem): boolean {
  if (a.id !== b.id || a.kind !== b.kind) return false;
  // role 必须一致（含同为 undefined）
  if ((a as { role?: unknown }).role !== (b as { role?: unknown }).role) return false;

  switch (a.kind) {
    case 'message':
      return b.kind === 'message'
        && a.message.role === b.message.role
        && a.message.content === b.message.content;
    case 'assistant_text':
    case 'reasoning':
      return (b.kind === 'assistant_text' || b.kind === 'reasoning')
        && a.roundId === b.roundId
        && a.text === b.text
        && a.isStreaming === b.isStreaming
        && a.startTs === b.startTs;
    case 'tool':
      return b.kind === 'tool'
        && a.roundId === b.roundId
        && a.tool.key === b.tool.key
        && a.tool.name === b.tool.name
        && a.tool.status === b.tool.status
        && a.tool.output === b.tool.output
        && a.tool.startedAt === b.tool.startedAt
        && a.tool.elapsedMs === b.tool.elapsedMs
        && JSON.stringify(a.tool.args) === JSON.stringify(b.tool.args);
  }
}

/**
 * 将 TranscriptStore 投影为 `TimelineItem[]`，未变更条目复用缓存引用。
 */
export function transcriptToTimeline(
  store: TranscriptStore,
  cache: Map<string, TimelineItem>,
): TimelineItem[] {
  const items = store.toTimelineItems();
  const activeIds = new Set<string>();

  const projected = items.map(item => {
    activeIds.add(item.id);
    const cached = cache.get(item.id);
    if (cached && timelineEntryEquals(cached, item)) {
      return cached;
    }
    const snapshot = cloneForReact(item);
    cache.set(item.id, snapshot);
    return snapshot;
  });

  for (const id of cache.keys()) {
    if (!activeIds.has(id)) cache.delete(id);
  }

  return projected;
}

function cloneForReact(item: TimelineItem): TimelineItem {
  switch (item.kind) {
    case 'message':
      return { ...item, message: { ...item.message } };
    case 'assistant_text':
    case 'reasoning':
      return { ...item, text: item.text };
    case 'tool':
      return { ...item, tool: { ...item.tool, args: { ...item.tool.args } } };
  }
}
