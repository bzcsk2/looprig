import type { ReasonixEngine } from '@covalo/core';
import type { ChatMessage } from '@covalo/core';
import { setTUIState } from './App.js';

export interface ToolStatus {
  name: string;
  status: 'running' | 'done' | 'error';
  args?: Record<string, unknown>;
  output?: string;
}

export interface ToolCallRecord {
  name: string;
  command: string;
  output: string;
  isError: boolean;
}

export interface BridgeState {
  messages: ChatMessage[];
  isLoading: boolean;
  streamingText: string | null;
  reasoningText: string | null;
  activeTools: Map<string, ToolStatus>;
  toolHistory: ToolCallRecord[];
  messageQueue: string[];
  tokens: { input: number; output: number; cacheHit: number; cacheMiss: number };
  contextUsage: number;
  warnings: string[];
  error: string | null;
  permissionPrompt: { toolName: string; args: Record<string, unknown> } | null;
}

export function createBridge(
  engine: ReasonixEngine,
  setState: React.Dispatch<React.SetStateAction<BridgeState>>
): {
  submit: (text: string) => Promise<void>;
  cancel: () => void;
} {
  let assistantContent = "";
  let reasoningContent = "";
  let activeAssistantMsg: ChatMessage | null = null;
  const toolCallArgsAccum = new Map<number, string>();
  let processingQueue = false;

  const processQueue = () => {
    if (processingQueue) return;
    processingQueue = true;
    setState(prev => {
      const [next, ...rest] = prev.messageQueue;
      if (next) {
        // Defer submit to avoid setState-during-render
        setTimeout(() => {
          processingQueue = false;
          submit(next);
        }, 0);
        return { ...prev, messageQueue: rest };
      }
      processingQueue = false;
      return prev;
    });
  };

  const submit = async (text: string) => {
    // If already loading, queue the message
    const shouldQueue = await new Promise<boolean>(resolve => {
      setState(prev => {
        if (prev.isLoading) {
          resolve(true);
          return { ...prev, messageQueue: [...prev.messageQueue, text] };
        }
        resolve(false);
        return { ...prev, isLoading: true };
      });
    });

    if (shouldQueue) return;

    setTUIState('loading');
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user' as const, content: text }],
      streamingText: null,
      reasoningText: null,
      toolHistory: [],
      error: null,
      warnings: [],
      permissionPrompt: null,
    }));

    assistantContent = "";
    reasoningContent = "";
    activeAssistantMsg = null;
    toolCallArgsAccum.clear();

    try {
      for await (const event of engine.submit(text)) {
        switch (event.role) {
          case "assistant_delta":
            if (!activeAssistantMsg) {
              activeAssistantMsg = { role: 'assistant', content: '' };
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, activeAssistantMsg!],
              }));
            }
            assistantContent += event.content ?? "";
            setState(prev => ({ ...prev, streamingText: assistantContent }));
            break;

          case "assistant_final": {
            // Capture values BEFORE clearing — React batches setState
            // and the functional updater captures variables by reference.
            // By the time React executes the updater, these would be null/""
            // if we clear them first.
            const msgRef = activeAssistantMsg;
            const content = assistantContent;
            if (msgRef) {
              setState(prev => ({
                ...prev,
                streamingText: null,
                messages: prev.messages.map(m =>
                  m === msgRef ? { ...m, content } : m
                ),
              }));
            }
            activeAssistantMsg = null;
            assistantContent = "";
            break;
          }

          case "reasoning_delta":
            reasoningContent += event.content ?? "";
            setState(prev => ({ ...prev, reasoningText: reasoningContent }));
            break;

          case "tool_start": {
            setState(prev => {
              const newTools = new Map(prev.activeTools);
              const key = `tool_${event.toolCallIndex ?? crypto.randomUUID()}`;
              // Parse args from accumulated tool_call_delta data
              let args: Record<string, unknown> = {};
              const idx = event.toolCallIndex ?? 0;
              const raw = toolCallArgsAccum.get(idx);
              if (raw) {
                try { args = JSON.parse(raw); } catch {}
                toolCallArgsAccum.delete(idx);
              }
              newTools.set(key, {
                name: event.toolName ?? 'unknown',
                status: 'running',
                args,
              });
              return { ...prev, activeTools: newTools };
            });
            break;
          }

          case "tool_progress":
            setState(prev => {
              const newTools = new Map(prev.activeTools);
              const key = `tool_${event.toolCallIndex}`;
              const existing = newTools.get(key);
              if (existing) {
                const newStatus = event.content === 'done' ? 'done' : 'running';
                newTools.set(key, { ...existing, status: newStatus });
              }
              return { ...prev, activeTools: newTools };
            });
            break;

          case "tool_call_delta":
            // Accumulate arguments JSON from streaming delta
            if (event.toolCallIndex !== undefined && event.content) {
              toolCallArgsAccum.set(event.toolCallIndex, event.content);
            }
            break;

          case "tool": {
            setState(prev => {
              const newTools = new Map(prev.activeTools);
              const key = `tool_${event.toolCallIndex}`;
              const existing = newTools.get(key);
              if (existing) {
                newTools.set(key, { ...existing, status: 'done', output: event.content });
              }
              // Add to toolHistory as a single merged record
              const record: ToolCallRecord = {
                name: event.toolName ?? existing?.name ?? 'tool',
                command: existing?.args?.command ? String(existing.args.command) : '',
                output: event.content ?? '',
                isError: event.severity === 'error',
              };
              return {
                ...prev,
                activeTools: newTools,
                toolHistory: [...prev.toolHistory, record],
              };
            });
            break;
          }

          case "usage": {
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
              // Current request's prompt tokens ≈ current context size
              contextUsage: addInput,
            }));
            break;
          }

          case "error": {
            if (event.toolCallIndex !== undefined) {
              // Tool-related error: add to toolHistory
              setState(prev => {
                const toolKey = `tool_${event.toolCallIndex}`;
                const existing = prev.activeTools.get(toolKey);
                const record: ToolCallRecord = {
                  name: event.toolName ?? existing?.name ?? 'tool',
                  command: existing?.args?.command ? String(existing.args.command) : '',
                  output: event.content ?? 'Unknown error',
                  isError: true,
                };
                return {
                  ...prev,
                  toolHistory: [...prev.toolHistory, record],
                };
              });
            } else {
              setState(prev => ({
                ...prev,
                error: event.content ?? 'Unknown error',
              }));
            }
            break;
          }

          case "warning":
            setState(prev => ({
              ...prev,
              warnings: [...prev.warnings, event.content ?? 'Unknown warning'],
            }));
            break;

          case "status":
            if (event.content && event.content !== 'interrupted' && event.content !== 'tools_completed') {
              setState(prev => ({
                ...prev,
                warnings: [...prev.warnings, event.content!],
              }));
            }
            break;

          case "done":
            break;

          case "strategy_notify":
          case "strategy_estimate_refined":
            // Phase 2 events — not yet implemented, ignore
            break;

          case "permission_ask": {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(event.content ?? '{}'); } catch {}
            setState(prev => ({
              ...prev,
              permissionPrompt: { toolName: event.toolName ?? 'unknown', args },
            }));
            break;
          }

          default: {
            const _exhaustiveCheck: never = event.role;
            void _exhaustiveCheck;
            break;
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(prev => ({ ...prev, error: msg }));
    } finally {
      setTUIState('idle');
      setState(prev => {
        // If streamingText has content but no assistant_final copied it into
        // a message, finalize it here as a fallback.
        const content = prev.streamingText || assistantContent;
        if (activeAssistantMsg && content) {
          return {
            ...prev,
            isLoading: false,
            streamingText: null,
            messages: prev.messages.map(m =>
              m === activeAssistantMsg ? { ...m, content } : m
            ),
            activeTools: new Map(),
            permissionPrompt: null,
          };
        }
        return {
          ...prev,
          isLoading: false,
          streamingText: null,
          activeTools: new Map(),
          permissionPrompt: null,
        };
      });
      activeAssistantMsg = null;
      assistantContent = "";
      reasoningContent = "";
      // Process next queued message
      processQueue();
    }
  };

  const cancel = () => {
    engine.interrupt();
    setTUIState('idle');
    // Immediately reset loading state so the UI is responsive even if
    // the AsyncGenerator takes a moment to drain interrupted events
    setState(prev => ({
      ...prev,
      isLoading: false,
      streamingText: null,
      reasoningText: null,
      activeTools: new Map(),
      permissionPrompt: null,
    }));
  };

  return { submit, cancel };
}
