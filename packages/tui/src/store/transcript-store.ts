import type { ChatMessage, AgentRole } from '@deepreef/core';
import type { TimelineItem, ToolStatus } from '../bridge.js';
import { mergeTimelineEntries } from './hydration-merge.js';

/**
 * 带可选 role 字段的条目（用于内部读取/写入 role 属性时绕过联合类型窄化）。
 */
type TimelineEntryWithRole = TimelineItem & { role?: AgentRole };

/**
 * 只读快照，供 adapter / useSyncExternalStore 消费。
 */
export interface TranscriptSnapshot {
  readonly order: readonly string[];
  readonly version: number;
}

/**
 * 规范化 transcript 存储：按 id 索引 + 有序 order，流式文本就地追加。
 */
export class TranscriptStore {
  private order: string[] = [];
  private readonly entries = new Map<string, TimelineItem>();
  private readonly liveTouchedIds = new Set<string>();
  private readonly entryRevision = new Map<string, number>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  /**
   * @returns 当前版本号（每次变更 +1）
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * @returns 有序条目 id 与版本
   */
  getSnapshot(): TranscriptSnapshot {
    return { order: this.order, version: this.version };
  }

  /**
   * 订阅 store 变更（供 useSyncExternalStore 使用）。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * @returns 当前条目数量
   */
  getEntryCount(): number {
    return this.order.length;
  }

  /**
   * 用 timeline 全量替换内部状态（非 hydration 场景）。
   */
  replaceAll(items: TimelineItem[]): void {
    this.order = items.map(item => item.id);
    this.entries.clear();
    this.liveTouchedIds.clear();
    this.entryRevision.clear();
    for (const item of items) {
      this.entries.set(item.id, cloneTimelineItem(item));
      this.entryRevision.set(item.id, 0);
    }
    this.bump();
  }

  /**
   * Session hydration 合并：保留 live 期间写入的 part，拒绝陈旧空文本覆盖。
   */
  mergeHydration(incoming: TimelineItem[]): void {
    const local = this.toTimelineItems();
    const merged = mergeTimelineEntries(local, incoming, this.liveTouchedIds);
    this.order = merged.map(item => item.id);
    this.entries.clear();
    for (const item of merged) {
      this.entries.set(item.id, cloneTimelineItem(item));
      if (!this.entryRevision.has(item.id)) {
        this.entryRevision.set(item.id, 0);
      }
    }
    this.bump();
  }

  /**
   * @returns 指定 part 的 revision（live 事件单调递增）
   */
  getPartRevision(partId: string): number {
    return this.entryRevision.get(partId) ?? 0;
  }

  /**
   * @returns 是否曾有 live 流式写入
   */
  hasLiveTouchedEntries(): boolean {
    return this.liveTouchedIds.size > 0;
  }

  /**
   * 导出有序 timeline（内部可变条目，仅供 adapter 读取）。
   */
  toTimelineItems(): TimelineItem[] {
    return this.order.map(id => this.entries.get(id)!);
  }

  private markLiveTouch(id: string): void {
    this.liveTouchedIds.add(id);
    this.entryRevision.set(id, (this.entryRevision.get(id) ?? 0) + 1);
  }

  /**
   * 追加任意角色消息条目。
   */
  appendMessage(id: string, message: ChatMessage, role?: AgentRole): void {
    const entry: TimelineItem = { id, kind: 'message', message: { ...message }, role };
    this.order.push(id);
    this.entries.set(id, entry);
    this.markLiveTouch(id);
    this.bump();
  }

  /**
   * 追加用户消息条目。
   */
  appendUser(id: string, content: string, role?: AgentRole): void {
    this.appendMessage(id, { role: 'user', content }, role);
  }

  /**
   * 确保流式 text / reasoning 条目存在。
   */
  ensureTextPart(
    id: string,
    kind: 'assistant_text' | 'reasoning',
    roundId: string,
    startTs: number,
    role?: AgentRole,
  ): void {
    if (this.entries.has(id)) {
      // 已存在但缺 role（例如 hydration 合并进来的旧条目）：补齐角色信息
      const existing = this.entries.get(id)!;
      if (role && !(existing as TimelineEntryWithRole).role) {
        (existing as TimelineEntryWithRole).role = role;
        this.markLiveTouch(id);
        this.bump();
      }
      return;
    }

    const entry: TimelineItem = {
      id,
      kind,
      roundId,
      text: '',
      isStreaming: true,
      startTs,
      role,
    };

    if (kind === 'assistant_text') {
      const insertBefore = this.order.findIndex(existingId => {
        const existing = this.entries.get(existingId);
        return Boolean(
          existing
          && 'roundId' in existing
          && existing.roundId === roundId
          && existing.kind === 'tool',
        );
      });
      if (insertBefore === -1) {
        this.order.push(id);
      } else {
        this.order.splice(insertBefore, 0, id);
      }
    } else {
      this.order.push(id);
    }

    this.entries.set(id, entry);
    this.markLiveTouch(id);
    this.bump();
  }

  /**
   * O(1) 追加流式文本 chunk，不复制 order 数组。
   */
  appendPartDelta(partId: string, chunk: string): boolean {
    const entry = this.entries.get(partId);
    if (!entry || (entry.kind !== 'assistant_text' && entry.kind !== 'reasoning')) {
      return false;
    }
    entry.text += chunk;
    this.markLiveTouch(partId);
    this.bump();
    return true;
  }

  /**
   * 覆盖流式 part 全文（如 assistant_final）。
   */
  setTextPart(partId: string, text: string, isStreaming: boolean): void {
    const entry = this.entries.get(partId);
    if (!entry || (entry.kind !== 'assistant_text' && entry.kind !== 'reasoning')) {
      return;
    }
    entry.text = text;
    entry.isStreaming = isStreaming;
    this.markLiveTouch(partId);
    this.bump();
  }

  /**
   * 标记 part 流式结束。
   */
  finalizePart(partId: string): void {
    const entry = this.entries.get(partId);
    if (!entry || (entry.kind !== 'assistant_text' && entry.kind !== 'reasoning')) {
      return;
    }
    entry.isStreaming = false;
    this.markLiveTouch(partId);
    this.bump();
  }

  /**
   * upsert 助手正文（含 assistant 在 reasoning/tool 之前的插入规则）。
   */
  upsertAssistantText(item: Extract<TimelineItem, { kind: 'assistant_text' }>): void {
    const existing = this.entries.get(item.id);
    if (existing) {
      this.entries.set(item.id, { ...item, text: item.text });
      this.markLiveTouch(item.id);
      this.bump();
      return;
    }

    const insertBefore = this.order.findIndex(existingId => {
      const candidate = this.entries.get(existingId);
      return Boolean(
        candidate
        && 'roundId' in candidate
        && candidate.roundId === item.roundId
        && candidate.kind === 'tool',
      );
    });

    if (insertBefore === -1) {
      this.order.push(item.id);
    } else {
      this.order.splice(insertBefore, 0, item.id);
    }
    this.entries.set(item.id, cloneTimelineItem(item));
    this.markLiveTouch(item.id);
    this.bump();
  }

  /**
   * upsert reasoning 条目。
   */
  upsertReasoning(item: Extract<TimelineItem, { kind: 'reasoning' }>): void {
    const existing = this.entries.get(item.id);
    if (existing) {
      this.entries.set(item.id, { ...item, text: item.text });
    } else {
      this.order.push(item.id);
      this.entries.set(item.id, cloneTimelineItem(item));
    }
    this.markLiveTouch(item.id);
    this.bump();
  }

  /**
   * upsert 工具条目。
   */
  upsertTool(
    id: string,
    roundId: string,
    tool: ToolStatus,
    merge?: (existing: ToolStatus) => ToolStatus,
    role?: AgentRole,
  ): void {
    const existing = this.entries.get(id);
    if (existing?.kind === 'tool') {
      existing.tool = merge ? merge(existing.tool) : { ...existing.tool, ...tool };
      // 补齐 role（hydration 合并进来的旧条目可能缺失）
      if (role && !existing.role) (existing as TimelineEntryWithRole).role = role;
      this.markLiveTouch(id);
      this.bump();
      return;
    }

    this.order.push(id);
    this.entries.set(id, { id, kind: 'tool', roundId, tool: { ...tool }, role });
    this.markLiveTouch(id);
    this.bump();
  }

  /**
   * 通用 upsert（非 assistant 插入规则场景）。
   */
  upsertItem(item: TimelineItem, update?: (existing: TimelineItem) => TimelineItem): void {
    const existing = this.entries.get(item.id);
    if (!existing) {
      this.order.push(item.id);
      this.entries.set(item.id, cloneTimelineItem(item));
      this.bump();
      return;
    }
    this.entries.set(item.id, update ? update(existing) : cloneTimelineItem(item));
    this.bump();
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * 克隆 timeline 条目，避免外部修改污染 store。
 */
function cloneTimelineItem(item: TimelineItem): TimelineItem {
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
