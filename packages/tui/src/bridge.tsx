import type { ChatMessage, ReasonixEngine } from '@deepicode/core';
import { setTUIState } from './App.js';
import { t } from './i18n/index.js';

export interface ToolStatus {
  key: string;
  name: string;
  status: 'running' | 'done' | 'error';
  args: Record<string, unknown>;
  output: string;
  startedAt: number;
  elapsedMs?: number;
}

export interface TurnView {
  id: string;
  userText: string;
  assistantText: string;
  streamingText: string | null;
  reasoningText: string;
  tools: ToolStatus[];
  isLoading: boolean;
  cancelled?: boolean;
  startTs: number;
  elapsedMs?: number;
}

export type TimelineItem =
  | { id: string; kind: 'message'; message: ChatMessage }
  | { id: string; kind: 'turn'; turn: TurnView };

export interface BridgeState {
  timeline: TimelineItem[];
  isLoading: boolean;
  messageQueue: string[];
  pendingInstructionCount: number;
  tokens: { input: number; output: number; cacheHit: number; cacheMiss: number };
  contextUsage: number;
  warnings: string[];
  error: string | null;
  permissionPrompt: { toolName: string; args: Record<string, unknown> } | null;
  thinkingMode: string;
}

export function timelineFromMessages(messages: ChatMessage[]): TimelineItem[] {
  return messages.map((message, index) => ({
    id: `message-${index}-${crypto.randomUUID()}`,
    kind: 'message',
    message,
  }));
}

function fallbackToolKey(index: number | undefined, name: string | undefined): string {
  return index === undefined ? `tool_${name ?? 'unknown'}` : `tool_${index}`;
}

export function createBridge(
  engine: ReasonixEngine,
  setState: React.Dispatch<React.SetStateAction<BridgeState>>
): {
  submit: (text: string) => Promise<void>;
  cancel: () => void;
} {
  let running = false;
  let processingQueue = false;
  let activeRequest = 0;

  const updateTurn = (turnId: string, update: (turn: TurnView) => TurnView) => {
    setState(prev => ({
      ...prev,
      timeline: prev.timeline.map(item =>
        item.kind === 'turn' && item.turn.id === turnId
          ? { ...item, turn: update(item.turn) }
          : item
      ),
    }));
  };

  const processQueue = () => {
    if (running || processingQueue) return;
    processingQueue = true;
    setState(prev => {
      const [next, ...rest] = prev.messageQueue;
      if (!next) {
        processingQueue = false;
        return prev;
      }
      setTimeout(() => {
        processingQueue = false;
        void submit(next);
      }, 0);
      return { ...prev, messageQueue: rest };
    });
  };

  const submit = async (text: string) => {
    if (running) {
      // P3: Try injecting into current submit first
      const result = engine.enqueueInstruction(text);
      if (result.status === 'queued') {
        setState(prev => ({ ...prev, pendingInstructionCount: result.queueLength }));
        return;
      }
      if (result.status === 'full') {
        // Queue full — fall back to messageQueue so no message is lost
        setState(prev => ({
          ...prev,
          pendingInstructionCount: result.queueLength,
          messageQueue: [...prev.messageQueue, text],
        }));
        return;
      }
      if (result.status === 'ignored') return;
      // idle race — fall back to messageQueue
      setState(prev => ({ ...prev, messageQueue: [...prev.messageQueue, text] }));
      return;
    }

    running = true;
    const requestId = ++activeRequest;
    const turnId = `turn-${requestId}-${crypto.randomUUID()}`;
    let assistantContent = '';
    let reasoningContent = '';
    const toolCallArgs = new Map<number, string>();
    const activeToolKeys = new Map<number, string>();
    let toolSequence = 0;

    setTUIState('loading');
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      warnings: [],
      permissionPrompt: null,
      timeline: [...prev.timeline, {
        id: turnId,
        kind: 'turn',
        turn: {
          id: turnId,
          userText: text,
          assistantText: '',
          streamingText: null,
          reasoningText: '',
          tools: [],
          isLoading: true,
          startTs: Date.now(),
        },
      }],
    }));

    try {
      for await (const event of engine.submit(text)) {
        if (requestId !== activeRequest) continue;

        switch (event.role) {
          case 'assistant_delta':
            assistantContent += event.content ?? '';
            updateTurn(turnId, turn => ({ ...turn, streamingText: assistantContent }));
            break;

          case 'assistant_final':
            assistantContent = event.content ?? assistantContent;
            if (typeof event.metadata?.reasoning === 'string') {
              reasoningContent = event.metadata.reasoning;
            }
            updateTurn(turnId, turn => ({
              ...turn,
              assistantText: assistantContent,
              streamingText: null,
              reasoningText: reasoningContent || turn.reasoningText,
            }));
            break;

          case 'reasoning_delta':
            reasoningContent += event.content ?? '';
            updateTurn(turnId, turn => ({ ...turn, reasoningText: reasoningContent }));
            break;

          case 'tool_call_delta':
            if (event.toolCallIndex !== undefined && event.content) {
              toolCallArgs.set(event.toolCallIndex, event.content);
            }
            break;

          case 'tool_start': {
            const key = `${fallbackToolKey(event.toolCallIndex, event.toolName)}_${++toolSequence}`;
            if (event.toolCallIndex !== undefined) activeToolKeys.set(event.toolCallIndex, key);
            const raw = event.toolCallIndex === undefined ? undefined : toolCallArgs.get(event.toolCallIndex);
            let args: Record<string, unknown> = {};
            if (raw) {
              try { args = JSON.parse(raw); } catch {}
            }
            updateTurn(turnId, turn => ({
              ...turn,
              tools: [...turn.tools.filter(tool => tool.key !== key), {
                key,
                name: event.toolName ?? 'unknown',
                status: 'running',
                args,
                output: '',
                startedAt: Date.now(),
              }],
            }));
            break;
          }

          case 'tool_progress':
            if (event.content === 'done') {
              const key = event.toolCallIndex === undefined
                ? fallbackToolKey(undefined, event.toolName)
                : activeToolKeys.get(event.toolCallIndex) ?? fallbackToolKey(event.toolCallIndex, event.toolName);
              updateTurn(turnId, turn => ({
                ...turn,
                tools: turn.tools.map(tool =>
                  tool.key === key
                    ? { ...tool, status: tool.status === 'error' ? 'error' : 'done', elapsedMs: Date.now() - tool.startedAt }
                    : tool
                ),
              }));
              if (event.toolCallIndex !== undefined) activeToolKeys.delete(event.toolCallIndex);
            } else if (event.content !== 'running') {
              // P5.5: intermediate progress — update tool output preview
              const key = event.toolCallIndex === undefined
                ? fallbackToolKey(undefined, event.toolName)
                : activeToolKeys.get(event.toolCallIndex) ?? fallbackToolKey(event.toolCallIndex, event.toolName);
              updateTurn(turnId, turn => ({
                ...turn,
                tools: turn.tools.map(tool =>
                  tool.key === key
                    ? { ...tool, output: tool.output + (tool.output ? '\n' : '') + event.content, elapsedMs: Date.now() - tool.startedAt }
                    : tool
                ),
              }));
            }
            break;

          case 'tool': {
            const key = event.toolCallIndex === undefined
              ? fallbackToolKey(undefined, event.toolName)
              : activeToolKeys.get(event.toolCallIndex) ?? fallbackToolKey(event.toolCallIndex, event.toolName);
            updateTurn(turnId, turn => ({
              ...turn,
              tools: turn.tools.map(tool =>
                tool.key === key
                  ? {
                      ...tool,
                      status: event.severity === 'error' ? 'error' : 'done',
                      output: event.content ?? '',
                      elapsedMs: Date.now() - tool.startedAt,
                    }
                  : tool
              ),
            }));
            break;
          }

          case 'error':
            if (event.toolCallIndex !== undefined) {
              const key = activeToolKeys.get(event.toolCallIndex) ?? `${fallbackToolKey(event.toolCallIndex, event.toolName)}_${++toolSequence}`;
              updateTurn(turnId, turn => {
                const existing = turn.tools.find(tool => tool.key === key);
                const failed: ToolStatus = existing
                  ? { ...existing, status: 'error', output: event.content ?? t().unknownError, elapsedMs: Date.now() - existing.startedAt }
                  : {
                      key,
                      name: event.toolName ?? t().unknown,
                      status: 'error',
                      args: {},
                      output: event.content ?? t().unknownError,
                      startedAt: Date.now(),
                      elapsedMs: 0,
                    };
                return { ...turn, tools: [...turn.tools.filter(tool => tool.key !== key), failed] };
              });
            } else {
              setState(prev => ({ ...prev, error: event.content ?? t().unknownError }));
            }
            break;

          case 'usage': {
            const addInput = typeof event.metadata?.input === 'number' ? event.metadata.input : 0;
            const addOutput = typeof event.metadata?.output === 'number' ? event.metadata.output : 0;
            const addCacheHit = typeof event.metadata?.cacheHit === 'number' ? event.metadata.cacheHit : 0;
            const addCacheMiss = typeof event.metadata?.cacheMiss === 'number' ? event.metadata.cacheMiss : 0;
            setState(prev => ({
              ...prev,
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

          case 'warning':
            setState(prev => ({ ...prev, warnings: [...prev.warnings, event.content ?? t().unknownWarning] }));
            break;

          case 'status':
            if (event.metadata?.kind === 'instruction_injected') {
              // P3: Update injection count from Core metadata
              const queueLen = typeof event.metadata.queueLength === 'number' ? event.metadata.queueLength : 0;
              setState(prev => ({ ...prev, pendingInstructionCount: queueLen }));
            } else if (event.content === 'thinking_mode_switch') {
              // AS4: Update thinking mode from auto-switch
              const to = event.metadata?.to as string;
              if (to) setState(prev => ({ ...prev, thinkingMode: to }));
            } else if (event.content && event.content !== 'interrupted' && event.content !== 'tools_completed') {
              setState(prev => ({ ...prev, warnings: [...prev.warnings, event.content!] }));
            }
            break;

          case 'permission_ask': {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(event.content ?? '{}'); } catch {}
            setState(prev => ({
              ...prev,
              permissionPrompt: { toolName: event.toolName ?? 'unknown', args },
            }));
            break;
          }

          case 'done':
          case 'strategy_notify':
            break;

          case 'strategy_estimate_refined':
            break;

          case 'tier_recommendation':
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
        setState(prev => ({ ...prev, error: msg }));
      }
    } finally {
      if (requestId === activeRequest) {
        setTUIState('idle');
        updateTurn(turnId, turn => ({
          ...turn,
          assistantText: turn.assistantText || assistantContent,
          streamingText: null,
          isLoading: false,
          elapsedMs: Date.now() - turn.startTs,
        }));
        setState(prev => ({ ...prev, isLoading: false, permissionPrompt: null }));
      }
      running = false;
      processQueue();
    }
  };

  const cancel = () => {
    engine.respondPermission(false);
    engine.interrupt();
    setState(prev => ({ ...prev, permissionPrompt: null }));
  };

  return { submit, cancel };
}
