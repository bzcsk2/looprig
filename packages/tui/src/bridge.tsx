import type { ReasonixEngine } from '@deepicode/core';
import type { ChatMessage } from '@deepicode/core';
import { setTUIState } from './App.js';

export interface ToolStatus {
  name: string;
  status: 'running' | 'done' | 'error';
  input?: Record<string, unknown>;
  output?: string;
}

export interface BridgeState {
  messages: ChatMessage[];
  isLoading: boolean;
  streamingText: string | null;
  reasoningText: string | null;
  activeTools: Map<string, ToolStatus>;
  tokens: { input: number; output: number; cacheHit: number; cacheMiss: number };
  contextUsage: number;
  warnings: string[];
  error: string | null;
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

  const submit = async (text: string) => {
    setTUIState('loading');
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user' as const, content: text }],
      isLoading: true,
      streamingText: null,
      reasoningText: null,
      error: null,
      warnings: [],
    }));

    assistantContent = "";
    reasoningContent = "";
    activeAssistantMsg = null;

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

          case "assistant_final":
            if (activeAssistantMsg) {
              activeAssistantMsg.content = assistantContent;
              setState(prev => ({ ...prev, streamingText: null }));
            }
            activeAssistantMsg = null;
            assistantContent = "";
            break;

          case "reasoning_delta":
            reasoningContent += event.content ?? "";
            setState(prev => ({ ...prev, reasoningText: reasoningContent }));
            break;

          case "tool_start":
            setState(prev => {
              const newTools = new Map(prev.activeTools);
              const key = `tool_${event.toolCallIndex ?? crypto.randomUUID()}`;
              newTools.set(key, {
                name: event.toolName ?? 'unknown',
                status: 'running',
              });
              return { ...prev, activeTools: newTools };
            });
            break;

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
            break;

          case "tool":
            setState(prev => {
              const newTools = new Map(prev.activeTools);
              const key = `tool_${event.toolCallIndex}`;
              const existing = newTools.get(key);
              if (existing) {
                newTools.set(key, { ...existing, status: 'done', output: event.content });
              }
              return { ...prev, activeTools: newTools };
            });
            break;

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
              // Cumulative input tokens ≈ current context usage
              contextUsage: prev.tokens.input + addInput,
            }));
            break;
          }

          case "error":
            setState(prev => ({
              ...prev,
              error: event.content ?? 'Unknown error',
            }));
            break;

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
      setState(prev => ({
        ...prev,
        isLoading: false,
        streamingText: null,
        reasoningText: null,
        activeTools: new Map(),
      }));
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
    }));
  };

  return { submit, cancel };
}
