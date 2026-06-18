import type { ChatMessage, ReasonixEngine, QuestionRequest, PermissionRequest, PermissionReply, LoopEvent } from '@deepreef/core';
import type { AgentRole } from '@deepreef/core/agent-profile/types.js';
import type { WorkflowMode } from '@deepreef/core/dual-agent-runtime/types.js';
import type { DualAgentRuntime } from '@deepreef/core/dual-agent-runtime/dual-runtime.js';
import type { WorkflowCoordinator } from '@deepreef/core/workflow-coordinator/coordinator.js';
import type { WorkflowEvent } from '@deepreef/core/workflow-coordinator/types.js';
import { setTUIState } from './App.js';
import { DeltaBatcher, resolveDeltaFlushMs } from './delta-batcher.js';
import { t } from './i18n/index.js';
import {
  isTranscriptStoreEnabled,
  isBridgeRuntimeSplitEnabled,
  TranscriptStore,
  TranscriptReader,
  transcriptToTimeline,
  BridgeRuntime,
} from './store/index.js';

export interface ToolStatus {
  key: string;
  name: string;
  status: 'running' | 'done' | 'error';
  args: Record<string, unknown>;
  output: string;
  startedAt: number;
  elapsedMs?: number;
}

export type TimelineItem =
  | { id: string; kind: 'message'; message: ChatMessage; role?: AgentRole }
  | { id: string; kind: 'assistant_text'; roundId: string; text: string; isStreaming: boolean; startTs: number; role?: AgentRole }
  | { id: string; kind: 'reasoning'; roundId: string; text: string; isStreaming: boolean; startTs: number; role?: AgentRole }
  | { id: string; kind: 'tool'; roundId: string; tool: ToolStatus; role?: AgentRole };

export interface BridgeState {
  timeline: TimelineItem[];
  isLoading: boolean;
  messageQueue: string[];
  pendingInstructionCount: number;
  tokens: { input: number; output: number; cacheHit: number; cacheMiss: number };
  contextUsage: number;
  warnings: string[];
  error: string | null;
  permissionPrompt: PermissionRequest | null;
  questionPrompt: QuestionRequest | null;
  reasoningActive: boolean;
}

function historyRoundId(index: number): string {
  return `history-${index}-${crypto.randomUUID()}`;
}

export function timelineFromMessages(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  messages.forEach((message, index) => {
    const id = `message-${index}-${crypto.randomUUID()}`;
    if (message.role === 'assistant') {
      const roundId = historyRoundId(index);
      if (message.content) {
        items.push({
          id: `${id}-assistant`,
          kind: 'assistant_text',
          roundId,
          text: message.content,
          isStreaming: false,
          startTs: Date.now(),
        });
      }
      if (message.reasoning_content) {
        items.push({
          id: `${id}-reasoning`,
          kind: 'reasoning',
          roundId,
          text: message.reasoning_content,
          isStreaming: false,
          startTs: Date.now(),
        });
      }
      return;
    }
    items.push({ id, kind: 'message', message });
  });
  return items;
}

function fallbackToolKey(index: number | undefined, name: string | undefined): string {
  return index === undefined ? `tool_${name ?? 'unknown'}` : `tool_${index}`;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function applyAssistantToTimeline(
  items: TimelineItem[],
  item: Extract<TimelineItem, { kind: 'assistant_text' }>,
): TimelineItem[] {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index !== -1) {
    const next = [...items];
    next[index] = item;
    return next;
  }

  const firstTool = items.findIndex(existing =>
    'roundId' in existing
    && existing.roundId === item.roundId
    && existing.kind === 'tool',
  );
  if (firstTool === -1) return [...items, item];

  const next = [...items];
  next.splice(firstTool, 0, item);
  return next;
}

function applyReasoningToTimeline(
  items: TimelineItem[],
  item: Extract<TimelineItem, { kind: 'reasoning' }>,
): TimelineItem[] {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index !== -1) {
    const next = [...items];
    next[index] = item;
    return next;
  }
  return [...items, item];
}

function isTransientToolLoopWarning(message: string): boolean {
  return message.startsWith('Tool call loop detected:');
}

export function createBridge(
  engine: ReasonixEngine,
  setState: React.Dispatch<React.SetStateAction<BridgeState>>,
  onUserInput?: (text: string) => void,
  beforeSubmit?: () => Promise<void>,
  orchestrationStore?: import('./store/orchestration-store.js').OrchestrationStore,
  dualRuntime?: DualAgentRuntime,
  workflowCoordinator?: WorkflowCoordinator,
): {
  submit: (text: string, isQueueResubmit?: boolean, role?: AgentRole, mode?: WorkflowMode) => Promise<void>;
  cancel: () => void;
  respondPermission: (reply: PermissionReply, message?: string) => void;
  respondQuestion: (requestId: string, answers: string[][]) => void;
  rejectQuestion: (requestId: string) => void;
  /** Run a workflow goal through the WorkflowCoordinator */
  runWorkflow: (goal: string, onPhaseChange?: (phase: string, iteration: number, finalStatus?: string, reason?: string) => void) => Promise<void>;
  /** Resume a workflow that was blocked by a user interrupt */
  resumeWorkflow: (instruction: string, onPhaseChange?: (phase: string, iteration: number, finalStatus?: string, reason?: string) => void) => Promise<void>;
  /** Store 路径下用 timeline 全量同步 transcript（session 恢复等） */
  replaceTranscript: (items: TimelineItem[]) => void;
  /** 追加一条消息到 transcript（系统提示 / 模型切换等） */
  appendTimelineMessage: (message: ChatMessage) => void;
  /** Store 路径下的 React 订阅 reader */
  getTranscriptReader: () => TranscriptReader | null;
  /** 拆分后的 bridge 运行时 store */
  getBridgeRuntime: () => BridgeRuntime | null;
  /** 重置拆分后的 bridge 运行时（session 切换） */
  resetBridgeRuntime: () => void;
} {
  let running = false;
  let processingQueue = false;
  let activeRequest = 0;
  const transcriptStore = isTranscriptStoreEnabled() ? new TranscriptStore() : null;
  const transcriptReader = transcriptStore ? new TranscriptReader(transcriptStore) : null;
  const bridgeRuntime = isBridgeRuntimeSplitEnabled() ? new BridgeRuntime() : null;

  /**
   * 提交 bridge 状态变更；拆分模式下写入子 store 并跳过 React bridgeState 更新。
   * ADV-BUG-04: 副作用移出 updater，保持 updater 纯函数。
   */
  const commitBridge = (updater: (prev: BridgeState) => Partial<BridgeState>): void => {
    let patch: Partial<BridgeState> | undefined;
    setState(prev => {
      patch = updater(prev);
      if (bridgeRuntime && transcriptStore) {
        return prev;
      }
      return { ...prev, ...patch };
    });
    // ADV-BUG-04: 副作用在 updater 外执行，避免 React 严格模式 double-invoke
    if (bridgeRuntime && transcriptStore && patch) {
      bridgeRuntime.applyPatch(patch);
    }
  };

  const publishTimeline = (patch?: (prev: BridgeState) => Partial<BridgeState>) => {
    if (transcriptStore) {
      if (patch) commitBridge(patch);
      return;
    }

    if (patch) {
      commitBridge(patch);
      return;
    }

    commitBridge(() => ({}));
  };

  const hydrateStoreFromTimeline = (items: TimelineItem[]) => {
    if (!transcriptStore || !transcriptReader) return;
    transcriptStore.replaceAll(items);
    transcriptReader.invalidate();
  };

  const replaceTranscript = (items: TimelineItem[]) => {
    if (!transcriptStore) return;
    if (transcriptStore.hasLiveTouchedEntries()) {
      transcriptStore.mergeHydration(items);
    } else {
      hydrateStoreFromTimeline(items);
    }
    transcriptReader?.invalidate();
  };

  const appendTimelineMessage = (message: ChatMessage) => {
    if (transcriptStore) {
      transcriptStore.appendMessage(`message-${crypto.randomUUID()}`, message);
      return;
    }
    setState(prev => ({
      ...prev,
      timeline: [
        ...prev.timeline,
        { id: `message-${crypto.randomUUID()}`, kind: 'message', message },
      ],
    }));
  };

  const updateTimeline = (mutate: (items: TimelineItem[]) => TimelineItem[]) => {
    if (transcriptStore) {
      transcriptStore.replaceAll(mutate(transcriptStore.toTimelineItems()));
      transcriptReader?.invalidate();
      publishTimeline();
      return;
    }
    setState(prev => ({ ...prev, timeline: mutate(prev.timeline) }));
  };

  const clearTransientWarnings = () => {
    commitBridge(prev => {
      const warnings = prev.warnings.filter(warning => !isTransientToolLoopWarning(warning));
      return warnings.length === prev.warnings.length ? {} : { warnings };
    });
  };

  const upsertItem = (item: TimelineItem, update?: (existing: TimelineItem) => TimelineItem) => {
    if (transcriptStore) {
      transcriptStore.upsertItem(item, update);
      publishTimeline();
      return;
    }
    updateTimeline(items => {
      const index = items.findIndex(existing => existing.id === item.id);
      if (index === -1) return [...items, item];
      const next = [...items];
      next[index] = update ? update(next[index]!) : item;
      return next;
    });
  };

  const upsertAssistantText = (item: Extract<TimelineItem, { kind: 'assistant_text' }>) => {
    if (transcriptStore) {
      transcriptStore.upsertAssistantText(item);
      publishTimeline();
      return;
    }
    updateTimeline(items => applyAssistantToTimeline(items, item));
  };

  const processQueue = () => {
    if (running || processingQueue) return;
    processingQueue = true;
    let nextMessage: string | undefined;
    commitBridge(prev => {
      const [next, ...rest] = prev.messageQueue;
      if (!next) {
        processingQueue = false;
        return {};
      }
      nextMessage = next;
      return { messageQueue: rest };
    });
    // ADV-BUG-04: 副作用在 updater 外执行
    if (nextMessage !== undefined) {
      // 使用 setTimeout 而非 queueMicrotask，确保状态更新后再提交
      const msg = nextMessage;
      setTimeout(() => {
        processingQueue = false;
        void submit(msg, true);
      }, 0);
    }
  };

  const submit = async (text: string, isQueueResubmit = false, role?: AgentRole, mode: WorkflowMode = 'alone') => {
    if (running) {
      const result = engine.enqueueInstruction(text);
      if (result.status === 'ignored') return;
      // P0-2: Observe on first successful acceptance (queued/full/queued-ok)
      if (!isQueueResubmit) {
        onUserInput?.(text);
      }
      if (result.status === 'queued') {
        commitBridge(() => ({ pendingInstructionCount: result.queueLength }));
        return;
      }
      if (result.status === 'full') {
        commitBridge(prev => ({
          pendingInstructionCount: result.queueLength,
          messageQueue: [...prev.messageQueue, text],
        }));
        return;
      }
      commitBridge(prev => ({ messageQueue: [...prev.messageQueue, text] }));
      return;
    }

    // P0-2: Observe fresh user input (not queue re-submissions)
    if (!isQueueResubmit) {
      onUserInput?.(text);
    }

    running = true;
    const requestId = ++activeRequest;
    const submitRole: AgentRole | undefined = role;
    let activeOutputRole: AgentRole | undefined = submitRole;
    let roundNumber = 0;
    let roundId = '';
    let assistantId: string | null = null;
    let reasoningId: string | null = null;
    let assistantText = '';
    let reasoningText = '';
    const toolCallArgs = new Map<number, string>();
    const activeToolKeys = new Map<number, string>();
    const toolItemIds = new Map<string, string>();
    const toolOutputs = new Map<string, string>();
    let toolSequence = 0;
    let assistantStartTs = 0;
    let reasoningStartTs = 0;

    const flushStreamingUI = () => {
      if (transcriptStore) {
        publishTimeline(prev => ({
          reasoningActive: reasoningId && reasoningText ? true : prev.reasoningActive,
        }));
        return;
      }

      setState(prev => {
        let timeline = prev.timeline;
        let reasoningActive = prev.reasoningActive;

        if (assistantId && assistantText) {
          timeline = applyAssistantToTimeline(timeline, {
            id: assistantId,
            kind: 'assistant_text',
            roundId,
            text: assistantText,
            isStreaming: true,
            startTs: assistantStartTs,
            role: activeOutputRole,
          });
        }

        if (reasoningId && reasoningText) {
          reasoningActive = true;
          timeline = applyReasoningToTimeline(timeline, {
            id: reasoningId,
            kind: 'reasoning',
            roundId,
            text: reasoningText,
            isStreaming: true,
            startTs: reasoningStartTs,
            role: activeOutputRole,
          });
        }

        if (timeline === prev.timeline && reasoningActive === prev.reasoningActive) {
          return prev;
        }
        const patch = { timeline, reasoningActive };
        bridgeRuntime?.applyPatch(patch);
        return { ...prev, ...patch };
      });
    };

    const streamBatcher = new DeltaBatcher(resolveDeltaFlushMs(), flushStreamingUI);

    const startRound = () => {
      streamBatcher.cancel();
      roundNumber += 1;
      roundId = `turn-${requestId}-round-${roundNumber}-${crypto.randomUUID()}`;
      assistantId = null;
      reasoningId = null;
      assistantText = '';
      reasoningText = '';
      assistantStartTs = 0;
      reasoningStartTs = 0;
      toolCallArgs.clear();
      activeToolKeys.clear();
      toolItemIds.clear();
      toolOutputs.clear();
      toolSequence = 0;
    };

    const finalizeRound = () => {
      streamBatcher.flushNow();
      if (assistantId) {
        const id = assistantId;
        if (transcriptStore) {
          if (assistantText) {
            transcriptStore.ensureTextPart(id, 'assistant_text', roundId, assistantStartTs || Date.now(), activeOutputRole);
            transcriptStore.setTextPart(id, assistantText, false);
          }
          transcriptStore.finalizePart(id);
        } else {
          upsertItem({
            id,
            kind: 'assistant_text',
            roundId,
            text: assistantText,
            isStreaming: false,
            startTs: assistantStartTs || Date.now(),
            role: activeOutputRole,
          }, existing => existing.kind === 'assistant_text'
            ? { ...existing, text: assistantText, isStreaming: false }
            : existing);
        }
      }
      if (reasoningId) {
        const id = reasoningId;
        if (transcriptStore) {
          if (reasoningText) {
            transcriptStore.ensureTextPart(id, 'reasoning', roundId, reasoningStartTs || Date.now(), activeOutputRole);
            transcriptStore.setTextPart(id, reasoningText, false);
          }
          transcriptStore.finalizePart(id);
        } else {
          upsertItem({
            id,
            kind: 'reasoning',
            roundId,
            text: reasoningText,
            isStreaming: false,
            startTs: reasoningStartTs || Date.now(),
            role: activeOutputRole,
          }, existing => existing.kind === 'reasoning'
            ? { ...existing, text: reasoningText, isStreaming: false }
            : existing);
        }
      }
      if (transcriptStore) publishTimeline();
    };

    const ensureAssistant = () => {
      if (!assistantId) {
        assistantId = `${roundId}-assistant`;
        assistantStartTs = Date.now();
      }
      return assistantId;
    };

    const ensureReasoning = () => {
      if (!reasoningId) {
        reasoningId = `${roundId}-reasoning`;
        reasoningStartTs = Date.now();
      }
      return reasoningId;
    };

    const getToolItemId = (key: string) => {
      let itemId = toolItemIds.get(key);
      if (!itemId) {
        itemId = `${roundId}-${key}`;
        toolItemIds.set(key, itemId);
      }
      return itemId;
    };

    const upsertTool = (key: string, patch: Partial<ToolStatus>) => {
      const itemId = getToolItemId(key);
      const now = Date.now();
      const rawArgs = [...toolCallArgs.values()].at(-1);
      const cleanPatch = { ...patch };
      if (!cleanPatch.name) delete cleanPatch.name;
      const fallback: ToolStatus = {
        key,
        name: patch.name ?? key.replace(/_\d+$/, ''),
        status: 'running',
        args: parseArgs(rawArgs),
        output: '',
        startedAt: now,
      };
      const mergedTool = { ...fallback, ...cleanPatch };

      if (transcriptStore) {
        transcriptStore.upsertTool(itemId, roundId, mergedTool, existing => ({
          ...existing,
          ...cleanPatch,
          elapsedMs: patch.elapsedMs ?? (patch.status && patch.status !== 'running'
            ? now - existing.startedAt
            : existing.elapsedMs),
        }), activeOutputRole);
        publishTimeline();
        return;
      }

      upsertItem({
        id: itemId,
        kind: 'tool',
        roundId,
        tool: mergedTool,
        role: activeOutputRole,
      }, existing => {
        if (existing.kind !== 'tool') return existing;
        return {
          ...existing,
          tool: {
            ...existing.tool,
            ...cleanPatch,
            elapsedMs: patch.elapsedMs ?? (patch.status && patch.status !== 'running' ? now - existing.tool.startedAt : existing.tool.elapsedMs),
          },
        };
      });
    };

    startRound();
    setTUIState('loading');
    setState(prev => {
      const userItem: TimelineItem = {
        id: `user-${requestId}-${crypto.randomUUID()}`,
        kind: 'message',
        message: { role: 'user', content: text },
        role: submitRole,
      };

      if (transcriptStore) {
        if (transcriptStore.getEntryCount() === 0 && prev.timeline.length > 0) {
          hydrateStoreFromTimeline(prev.timeline);
        }
        transcriptStore.appendUser(userItem.id, text);
        bridgeRuntime?.applyPatch({
          isLoading: true,
          error: null,
          warnings: [],
          permissionPrompt: null,
        });
        return bridgeRuntime ? prev : {
          ...prev,
          isLoading: true,
          error: null,
          warnings: [],
          permissionPrompt: null,
        };
      }

      return {
        ...prev,
        isLoading: true,
        error: null,
        warnings: [],
        permissionPrompt: null,
        timeline: [...prev.timeline, userItem],
      };
    });

    try {
      await beforeSubmit?.();
      // WF-FIX-10: Route through DualAgentRuntime when available
      const eventStream = dualRuntime && submitRole
        ? dualRuntime.sendDirect({ role: submitRole, input: text, mode })
        : engine.submit(text, undefined, submitRole, mode);
      for await (const event of eventStream) {
        if (requestId !== activeRequest) continue;
        const eventRole = event.metadata?.agentRole === 'worker' || event.metadata?.agentRole === 'supervisor'
          ? event.metadata.agentRole as AgentRole
          : submitRole;
        if (eventRole !== activeOutputRole) {
          finalizeRound();
          activeOutputRole = eventRole;
          startRound();
        }

        switch (event.role) {
          case 'assistant_delta': {
            const chunk = event.content ?? '';
            assistantText += chunk;
            const id = ensureAssistant();
            if (transcriptStore) {
              transcriptStore.ensureTextPart(id, 'assistant_text', roundId, assistantStartTs, activeOutputRole);
              transcriptStore.appendPartDelta(id, chunk);
              streamBatcher.schedule();
            } else {
              streamBatcher.schedule();
            }
            break;
          }

          case 'assistant_final': {
            streamBatcher.flushNow();
            if (event.content) assistantText = event.content;
            const metadataReasoning = event.metadata?.reasoning;
            if (typeof metadataReasoning === 'string' && metadataReasoning.length > 0) {
              reasoningText = metadataReasoning;
            }
            if (assistantText) {
              const id = ensureAssistant();
              if (transcriptStore) {
                transcriptStore.ensureTextPart(id, 'assistant_text', roundId, assistantStartTs || Date.now(), activeOutputRole);
                transcriptStore.setTextPart(id, assistantText, false);
              } else {
                upsertAssistantText({
                  id,
                  kind: 'assistant_text',
                  roundId,
                  text: assistantText,
                  isStreaming: false,
                  startTs: assistantStartTs || Date.now(),
                  role: activeOutputRole,
                });
              }
            }
            if (reasoningText) {
              const id = ensureReasoning();
              const item = {
                id,
                kind: 'reasoning' as const,
                roundId,
                text: reasoningText,
                isStreaming: false,
                startTs: reasoningStartTs || Date.now(),
                role: activeOutputRole,
              };
              if (transcriptStore) {
                transcriptStore.upsertReasoning(item);
              } else {
                upsertItem(item);
              }
            }
            if (transcriptStore) publishTimeline();
            break;
          }

          case 'reasoning_delta': {
            clearTransientWarnings();
            const chunk = event.content ?? '';
            reasoningText += chunk;
            const id = ensureReasoning();
            if (transcriptStore) {
              transcriptStore.ensureTextPart(id, 'reasoning', roundId, reasoningStartTs, activeOutputRole);
              transcriptStore.appendPartDelta(id, chunk);
              streamBatcher.schedule();
            } else {
              upsertItem({
                id,
                kind: 'reasoning',
                roundId,
                text: reasoningText,
                isStreaming: true,
                startTs: reasoningStartTs,
                role: activeOutputRole,
              });
              commitBridge(() => ({ reasoningActive: true }));
            }
            break;
          }

          case 'tool_call_delta':
            clearTransientWarnings();
            if (event.toolCallIndex !== undefined && event.content) {
              toolCallArgs.set(event.toolCallIndex, event.content);
            }
            break;

          case 'tool_start': {
            clearTransientWarnings();
            const key = `${fallbackToolKey(event.toolCallIndex, event.toolName)}_${++toolSequence}`;
            if (event.toolCallIndex !== undefined) activeToolKeys.set(event.toolCallIndex, key);
            const raw = event.toolCallIndex === undefined ? undefined : toolCallArgs.get(event.toolCallIndex);
            upsertTool(key, {
              name: event.toolName ?? 'unknown',
              status: 'running',
              args: parseArgs(raw),
              output: '',
              startedAt: Date.now(),
            });
            break;
          }

          case 'tool_progress': {
            clearTransientWarnings();
            const key = event.toolCallIndex === undefined
              ? fallbackToolKey(undefined, event.toolName)
              : activeToolKeys.get(event.toolCallIndex) ?? fallbackToolKey(event.toolCallIndex, event.toolName);
            const name = event.toolName || undefined;
            if (event.content === 'done') {
              upsertTool(key, { name, status: 'done' });
              break;
            }
            if (event.content && event.content !== 'running') {
              const previous = toolOutputs.get(key) ?? '';
              const output = previous + (previous ? '\n' : '') + event.content;
              toolOutputs.set(key, output);
              upsertTool(key, {
                name,
                output,
              });
            }
            break;
          }

          case 'tool': {
            const key = event.toolCallIndex === undefined
              ? fallbackToolKey(undefined, event.toolName)
              : activeToolKeys.get(event.toolCallIndex) ?? fallbackToolKey(event.toolCallIndex, event.toolName);
            upsertTool(key, {
              name: event.toolName ?? 'tool',
              status: event.severity === 'error' ? 'error' : 'done',
              output: event.content ?? '',
            });
            toolOutputs.set(key, event.content ?? '');
            break;
          }

          case 'error':
            if (event.toolCallIndex !== undefined) {
              const key = activeToolKeys.get(event.toolCallIndex) ?? `${fallbackToolKey(event.toolCallIndex, event.toolName)}_${++toolSequence}`;
              upsertTool(key, {
                name: event.toolName ?? t().unknown,
                status: 'error',
                output: event.content ?? t().unknownError,
              });
              toolOutputs.set(key, event.content ?? t().unknownError);
            } else {
              commitBridge(() => ({ error: event.content ?? t().unknownError }));
            }
            break;

          case 'usage': {
            const addInput = typeof event.metadata?.input === 'number' ? event.metadata.input : 0;
            const addOutput = typeof event.metadata?.output === 'number' ? event.metadata.output : 0;
            const addCacheHit = typeof event.metadata?.cacheHit === 'number' ? event.metadata.cacheHit : 0;
            const addCacheMiss = typeof event.metadata?.cacheMiss === 'number' ? event.metadata.cacheMiss : 0;
            commitBridge(prev => ({
              tokens: {
                input: prev.tokens.input + addInput,
                output: prev.tokens.output + addOutput,
                cacheHit: prev.tokens.cacheHit + addCacheHit,
                cacheMiss: prev.tokens.cacheMiss + addCacheMiss,
              },
              contextUsage: addInput,
            }));
            break;
          }

          case 'warning': {
            const warning = event.content ?? t().unknownWarning;
            commitBridge(prev => ({
              warnings: isTransientToolLoopWarning(warning)
                ? [...prev.warnings.filter(item => !isTransientToolLoopWarning(item)), warning]
                : [...prev.warnings, warning],
            }));
            break;
          }

          case 'status':
            if (event.metadata?.kind === 'instruction_injected') {
              const queueLen = typeof event.metadata.queueLength === 'number' ? event.metadata.queueLength : 0;
              commitBridge(() => ({ pendingInstructionCount: queueLen }));
            } else if (event.content === 'tools_completed') {
              finalizeRound();
              startRound();
            }
            break;

          case 'permission_ask': {
            // Parse permission request from event metadata
            const requestId = event.metadata?.requestId as string | undefined;
            const sessionId = event.metadata?.sessionId as string | undefined;
            const permission = event.metadata?.permission as string | undefined;
            const patterns = event.metadata?.patterns as string[] | undefined;
            const always = event.metadata?.always as string[] | undefined;
            const metadata = event.metadata?.metadata as Record<string, unknown> | undefined;
            const tool = event.metadata?.tool as { toolCallId: string; toolName: string } | undefined;
            const parentSessionId = event.metadata?.parentSessionId as string | undefined;

            if (requestId && sessionId && permission) {
              const permissionRequest: PermissionRequest = {
                id: requestId,
                sessionId,
                permission,
                patterns: patterns ?? [],
                always: always ?? [],
                metadata: metadata ?? {},
                tool: tool ?? { toolCallId: '', toolName: event.toolName ?? 'unknown' },
                parentSessionId,
              };
              commitBridge(() => ({ permissionPrompt: permissionRequest }));
            } else {
              // Fallback for legacy permission events
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(event.content ?? '{}'); } catch {}
              const fallbackRequest: PermissionRequest = {
                id: `perm_${Date.now().toString(36)}`,
                sessionId: '',
                permission: event.toolName ?? 'unknown',
                patterns: [],
                always: [],
                metadata: args,
                tool: { toolCallId: '', toolName: event.toolName ?? 'unknown' },
              };
              commitBridge(() => ({ permissionPrompt: fallbackRequest }));
            }
            break;
          }

          case 'question_ask': {
            // Parse question request from event metadata
            const requestId = event.metadata?.requestId as string | undefined;
            const sessionId = event.metadata?.sessionId as string | undefined;
            const questions = event.metadata?.questions as Array<{
              question: string;
              header: string;
              options: Array<{ label: string; description: string }>;
              multiple?: boolean;
              custom?: boolean;
            }> | undefined;
            if (requestId && sessionId && questions) {
              const questionRequest: QuestionRequest = { id: requestId, sessionId, questions };
              commitBridge(() => ({ questionPrompt: questionRequest }));
            }
            break;
          }

          case 'question_replied': {
            commitBridge(() => ({ questionPrompt: null }));
            break;
          }

          case 'question_rejected': {
            commitBridge(() => ({ questionPrompt: null }));
            break;
          }

          case 'done':
            break;

          case 'orchestration':
            if (event.orchestration && orchestrationStore) {
              orchestrationStore.apply(event.orchestration);
            }
            break;

          default: {
            const _exhaustiveCheck: never = event.role;
            void _exhaustiveCheck;
          }
        }
      }
    } catch (e: unknown) {
      if (requestId === activeRequest) {
        const msg = e instanceof Error ? e.message : String(e);
        commitBridge(() => ({ error: msg }));
      }
    } finally {
      if (requestId === activeRequest) {
        streamBatcher.flushNow();
        finalizeRound();
        setTUIState('idle');
        commitBridge(() => ({
          isLoading: false,
          permissionPrompt: null,
          reasoningActive: false,
        }));
      }
      running = false;
      processQueue();
    }
  };

  const cancel = () => {
    // Reject any pending permission
    commitBridge(prev => {
      if (prev.permissionPrompt) {
        engine.respondPermission(false);
      }
      if (prev.questionPrompt) {
        engine.rejectQuestion(prev.questionPrompt.id);
      }
      return { permissionPrompt: null, questionPrompt: null };
    });
    // WF-FIX-10: Interrupt both roles when DualAgentRuntime is active
    if (dualRuntime) {
      dualRuntime.getWorker().getEngine().respondPermission(false);
      dualRuntime.getSupervisor().getEngine().respondPermission(false);
      dualRuntime.interruptRole('worker');
      dualRuntime.interruptRole('supervisor');
    }
    // SFR-70: 中断正在运行的 Workflow
    workflowCoordinator?.interrupt();
    engine.interrupt();
  };

  const respondPermission = (reply: PermissionReply, message?: string) => {
    const allow = reply === 'once' || reply === 'always';
    const alwaysAllow = reply === 'always';
    engine.respondPermission(allow, alwaysAllow);
    dualRuntime?.getWorker().getEngine().respondPermission(allow, alwaysAllow);
    dualRuntime?.getSupervisor().getEngine().respondPermission(allow, alwaysAllow);
    commitBridge(() => ({ permissionPrompt: null }));
  };

  const respondQuestion = (requestId: string, answers: string[][]) => {
    engine.respondQuestion(requestId, answers);
    dualRuntime?.getWorker().getEngine().respondQuestion(requestId, answers);
    dualRuntime?.getSupervisor().getEngine().respondQuestion(requestId, answers);
    commitBridge(() => ({ questionPrompt: null }));
  };

  const rejectQuestion = (requestId: string) => {
    engine.rejectQuestion(requestId);
    dualRuntime?.getWorker().getEngine().rejectQuestion(requestId);
    dualRuntime?.getSupervisor().getEngine().rejectQuestion(requestId);
    commitBridge(() => ({ questionPrompt: null }));
  };

  /** WF-FIX-20: Run a workflow goal through the WorkflowCoordinator */
  const driveWorkflow = async (
    goal: string | null,
    onPhaseChange?: (phase: string, iteration: number, finalStatus?: string, reason?: string) => void,
    resumeInstruction?: string,
    workflowId?: string,
  ) => {
    if (!workflowCoordinator) {
      await submit(resumeInstruction ?? goal ?? '', false, 'supervisor');
      return;
    }

    // SFR-70: 标记 loading 使 Ctrl+C 能取消 Workflow
    setTUIState('loading');
    commitBridge(() => ({
      isLoading: true,
      error: null,
      warnings: [],
      permissionPrompt: null,
    }));

    if (resumeInstruction !== undefined) {
      workflowCoordinator.resumeInterruptedWorkflow(resumeInstruction);
    } else {
      if (workflowCoordinator.getState()) {
        workflowCoordinator.reset();
      }
      workflowCoordinator.startWorkflow({ goal: goal!, workflowId });
    }
    let activeRole: AgentRole = 'supervisor';
    let wfRoundId = '';
    let wfRoundTs = 0;
    let toolItemIds = new Map<string, string>();
    let toolCallArgs = new Map<number, string>();
    let toolOutputs = new Map<string, string>();
    let assistantText = '';
    let reasoningText = '';

    const upsertWorkflowItem = (item: TimelineItem) => {
      commitBridge(prev => {
        const index = prev.timeline.findIndex(existing => existing.id === item.id);
        if (index === -1) return { timeline: [...prev.timeline, item] };
        const timeline = [...prev.timeline];
        timeline[index] = item;
        return { timeline };
      });
    };

    const upsertWorkflowTool = (key: string, patch: Partial<ToolStatus>) => {
      const itemId = toolItemIds.get(key) ?? `wf-${key}-${crypto.randomUUID()}`;
      toolItemIds.set(key, itemId);
      const tool: ToolStatus = {
        key,
        name: patch.name ?? key.replace(/_\d+$/, ''),
        status: patch.status ?? 'running',
        args: patch.args ?? {},
        output: patch.output ?? '',
        startedAt: patch.startedAt ?? Date.now(),
        elapsedMs: patch.elapsedMs,
      };
      if (transcriptStore) {
        transcriptStore.upsertTool(itemId, wfRoundId, tool, current => ({ ...current, ...patch }), activeRole);
        publishTimeline();
      } else {
        commitBridge(prev => {
          const current = prev.timeline.find(item => item.id === itemId);
          const merged = current?.kind === 'tool' ? { ...current.tool, ...patch } : tool;
          const item: TimelineItem = { id: itemId, kind: 'tool', roundId: wfRoundId, tool: merged, role: activeRole };
          const index = prev.timeline.findIndex(entry => entry.id === itemId);
          if (index === -1) return { timeline: [...prev.timeline, item] };
          const timeline = [...prev.timeline];
          timeline[index] = item;
          return { timeline };
        });
      }
    };

    try {
      // Phase G: 主动重跑直到 goal 终结
      let runAgain = true;
      while (runAgain) {
        runAgain = false;
        for await (const rawEvent of workflowCoordinator.runWorkflow()) {
        const hasType = (rawEvent as any).type !== undefined;
        const hasRole = (rawEvent as any).role !== undefined;

        if (hasType) {
          const wfEvent = rawEvent as unknown as WorkflowEvent;

          if (wfEvent.type === 'phase_change' && wfEvent.phase && wfEvent.iteration != null) {
            activeRole = wfEvent.phase === 'worker_do' || wfEvent.phase === 'worker_report' ? 'worker' : 'supervisor';
            onPhaseChange?.(wfEvent.phase, wfEvent.iteration);
            if (orchestrationStore) {
              orchestrationStore.apply({
                kind: 'loop_transition',
                transition: {
                  from: (orchestrationStore.getSnapshot().loop.phase as any) ?? 'observe',
                  to: wfEvent.phase as any,
                  attempt: wfEvent.iteration,
                  timestamp: Date.now(),
                },
              });
            }
            wfRoundId = `wf-round-${crypto.randomUUID()}`;
            wfRoundTs = Date.now();
            assistantText = '';
            reasoningText = '';
            toolItemIds = new Map<string, string>();
            toolCallArgs = new Map<number, string>();
            toolOutputs = new Map<string, string>();
          }
          if (wfEvent.type === 'completed') {
            onPhaseChange?.('completed', 0, 'completed');
          } else if (wfEvent.type === 'failed') {
            onPhaseChange?.('failed', 0, 'failed', wfEvent.reason);
          } else if (wfEvent.type === 'blocked') {
            onPhaseChange?.('blocked', 0, 'blocked', wfEvent.reason);
          }
        } else if (hasRole) {
          const loopEvent = rawEvent as unknown as LoopEvent;
          switch (loopEvent.role) {
            case 'assistant_delta': {
              if (!wfRoundId) break;
              assistantText += loopEvent.content ?? '';
              if (transcriptStore) {
                transcriptStore.ensureTextPart(wfRoundId + '-text', 'assistant_text', wfRoundId, wfRoundTs, activeRole);
                transcriptStore.appendPartDelta(wfRoundId + '-text', loopEvent.content ?? '');
                publishTimeline();
              } else {
                upsertWorkflowItem({ id: wfRoundId + '-text', kind: 'assistant_text', roundId: wfRoundId, text: assistantText, isStreaming: true, startTs: wfRoundTs, role: activeRole });
              }
              break;
            }
            case 'assistant_final': {
              if (!wfRoundId) break;
              if (loopEvent.content) assistantText = loopEvent.content;
              const metadataReasoning = loopEvent.metadata?.reasoning;
              if (typeof metadataReasoning === 'string' && metadataReasoning.length > 0) reasoningText = metadataReasoning;
              if (transcriptStore) {
                transcriptStore.ensureTextPart(wfRoundId + '-text', 'assistant_text', wfRoundId, wfRoundTs, activeRole);
                transcriptStore.setTextPart(wfRoundId + '-text', assistantText, false);
                publishTimeline();
              } else {
                upsertWorkflowItem({ id: wfRoundId + '-text', kind: 'assistant_text', roundId: wfRoundId, text: assistantText, isStreaming: false, startTs: wfRoundTs, role: activeRole });
              }
              if (reasoningText) {
                const item: TimelineItem = { id: wfRoundId + '-reasoning', kind: 'reasoning', roundId: wfRoundId, text: reasoningText, isStreaming: false, startTs: wfRoundTs, role: activeRole };
                if (transcriptStore) transcriptStore.upsertReasoning(item);
                else upsertWorkflowItem(item);
              }
              break;
            }
            case 'reasoning_delta': {
              if (!wfRoundId) break;
              reasoningText += loopEvent.content ?? '';
              if (transcriptStore) {
                transcriptStore.ensureTextPart(wfRoundId + '-reasoning', 'reasoning', wfRoundId, wfRoundTs, activeRole);
                transcriptStore.appendPartDelta(wfRoundId + '-reasoning', loopEvent.content ?? '');
                publishTimeline();
              } else {
                upsertWorkflowItem({ id: wfRoundId + '-reasoning', kind: 'reasoning', roundId: wfRoundId, text: reasoningText, isStreaming: true, startTs: wfRoundTs, role: activeRole });
              }
              break;
            }
            case 'tool_call_delta':
              if (loopEvent.toolCallIndex !== undefined && loopEvent.content) {
                toolCallArgs.set(loopEvent.toolCallIndex, loopEvent.content);
              }
              break;
            case 'tool_start': {
              const key = fallbackToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
              upsertWorkflowTool(key, {
                name: loopEvent.toolName ?? 'unknown',
                status: 'running',
                args: parseArgs(loopEvent.toolCallIndex === undefined ? undefined : toolCallArgs.get(loopEvent.toolCallIndex)),
                output: '',
                startedAt: Date.now(),
              });
              break;
            }
            case 'tool_progress': {
              const key = fallbackToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
              if (loopEvent.content === 'done') {
                upsertWorkflowTool(key, { status: 'done' });
              } else if (loopEvent.content && loopEvent.content !== 'running') {
                const previous = toolOutputs.get(key) ?? '';
                const output = previous + (previous ? '\n' : '') + loopEvent.content;
                toolOutputs.set(key, output);
                upsertWorkflowTool(key, { output });
              }
              break;
            }
            case 'tool': {
              const key = fallbackToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
              upsertWorkflowTool(key, {
                name: loopEvent.toolName ?? 'tool',
                status: loopEvent.severity === 'error' ? 'error' : 'done',
                output: loopEvent.content ?? '',
              });
              break;
            }
            case 'error': {
              const message = loopEvent.content ?? 'Unknown error';
              console.warn(`[tool:error] ${message}`);
              break;
            }
            case 'warning': {
              commitBridge(prev => ({
                ...prev,
                warnings: [...prev.warnings, loopEvent.content ?? 'Warning'],
              }));
              break;
            }
            case 'status':
              break;
            case 'done':
              break;
            case 'usage': {
              const addInput = typeof loopEvent.metadata?.input === 'number' ? loopEvent.metadata.input : 0;
              const addOutput = typeof loopEvent.metadata?.output === 'number' ? loopEvent.metadata.output : 0;
              commitBridge(prev => ({
                tokens: { ...prev.tokens, input: prev.tokens.input + addInput, output: prev.tokens.output + addOutput },
                contextUsage: addInput,
              }));
              break;
            }
            case 'permission_ask': {
              const requestId = loopEvent.metadata?.requestId as string | undefined;
              const sessionId = loopEvent.metadata?.sessionId as string | undefined;
              const permission = loopEvent.metadata?.permission as string | undefined;
              if (requestId && sessionId && permission) {
                commitBridge(() => ({
                  permissionPrompt: {
                    id: requestId,
                    sessionId,
                    permission,
                    patterns: loopEvent.metadata?.patterns as string[] ?? [],
                    always: loopEvent.metadata?.always as string[] ?? [],
                    metadata: loopEvent.metadata?.metadata as Record<string, unknown> ?? {},
                    tool: loopEvent.metadata?.tool as { toolCallId: string; toolName: string } ?? { toolCallId: '', toolName: loopEvent.toolName ?? 'unknown' },
                    parentSessionId: loopEvent.metadata?.parentSessionId as string | undefined,
                  },
                }));
              }
              break;
            }
            case 'question_ask': {
              const requestId = loopEvent.metadata?.requestId as string | undefined;
              const sessionId = loopEvent.metadata?.sessionId as string | undefined;
              const questions = loopEvent.metadata?.questions as QuestionRequest['questions'] | undefined;
              if (requestId && sessionId && questions) {
                commitBridge(() => ({ questionPrompt: { id: requestId, sessionId, questions } }));
              }
              break;
            }
            case 'question_replied':
            case 'question_rejected':
              commitBridge(() => ({ questionPrompt: null }));
              break;
            case 'orchestration':
              if (loopEvent.orchestration && orchestrationStore) orchestrationStore.apply(loopEvent.orchestration);
              break;
          }
        }
      }
        // Phase G: 检查 goal 状态决定是否继续下一轮
        const coordState = workflowCoordinator.getState();
        if (coordState && !workflowCoordinator.isFinished()) {
          const store = workflowCoordinator.getGoalStore?.();
          if (store) {
            const goal = store.getGoal(coordState.workflowId);
            if (goal && goal.status === "active") {
              runAgain = true;
            }
          }
        }
      }
    } catch (err) {
      commitBridge(prev => ({
        ...prev,
        warnings: [...prev.warnings, `Workflow error: ${(err as Error).message ?? String(err)}`],
      }));
    } finally {
      // SFR-70: 确保 always 恢复 idle，即使中断或异常
      setTUIState('idle');
      commitBridge(() => ({
        isLoading: false,
        permissionPrompt: null,
        reasoningActive: false,
      }));
    }
  };

  const runWorkflow = (
    goal: string,
    onPhaseChange?: (phase: string, iteration: number, finalStatus?: string, reason?: string) => void,
    workflowId?: string,
  ) => driveWorkflow(goal, onPhaseChange, undefined, workflowId);

  const resumeWorkflow = (
    instruction: string,
    onPhaseChange?: (phase: string, iteration: number, finalStatus?: string, reason?: string) => void,
  ) => driveWorkflow(null, onPhaseChange, instruction);

  return {
    submit,
    cancel,
    respondPermission,
    respondQuestion,
    rejectQuestion,
    runWorkflow,
    resumeWorkflow,
    replaceTranscript,
    appendTimelineMessage,
    getTranscriptReader: () => transcriptReader,
    getBridgeRuntime: () => bridgeRuntime,
    resetBridgeRuntime: () => bridgeRuntime?.reset(),
  };
}
