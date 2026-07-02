import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type React from 'react';
import type { LoopEvent } from '@covalo/core';
import type { ReasonixEngine } from '@covalo/core';
import { createBridge, type BridgeState, type TimelineItem } from '../src/bridge.js';

beforeAll(() => {
  process.env.DEEPCODE_TUI_STORE = '1';
  process.env.DEEPCODE_DELTA_FLUSH_MS = '0';
});

afterAll(() => {
  delete process.env.DEEPCODE_TUI_STORE;
  delete process.env.DEEPCODE_DELTA_FLUSH_MS;
});

function initialState(): BridgeState {
  return {
    timeline: [],
    isLoading: false,
    messageQueue: [],
    pendingInstructionCount: 0,
    tokens: { input: 0, output: 0, cacheHit: 0, cacheMiss: 0 },
    contextUsage: 0,
    warnings: [],
    error: null,
    permissionPrompt: null,
    questionPrompt: null,
    reasoningActive: false,
  };
}

function stateHarness() {
  let state = initialState();
  const setState: React.Dispatch<React.SetStateAction<BridgeState>> = update => {
    state = typeof update === 'function' ? update(state) : update;
  };
  return { get state() { return state; }, setState };
}

function mockEngine(generators: Array<(text: string) => AsyncGenerator<LoopEvent>>) {
  let isSubmitting = false;
  return {
    submit(text: string) {
      isSubmitting = true;
      const generator = generators.shift();
      if (!generator) throw new Error(`Unexpected submit: ${text}`);
      const gen = generator(text);
      return (async function* () {
        try {
          yield* gen;
        } finally {
          isSubmitting = false;
        }
      })();
    },
    enqueueInstruction: () => ({ status: 'idle' as const, queueLength: 0 }),
    interrupt: () => { isSubmitting = false; },
  };
}

function reasoningItems(timeline: TimelineItem[]) {
  return timeline.filter(
    (item): item is Extract<TimelineItem, { kind: 'reasoning' }> => item.kind === 'reasoning',
  );
}

describe('reasoning with TranscriptStore', () => {
  it('streams reasoning deltas into transcript reader with reasoning before assistant', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'reasoning_delta', content: 'think' };
        yield { role: 'reasoning_delta', content: ' hard' };
        yield { role: 'assistant_delta', content: 'ans' };
        yield { role: 'assistant_final', content: 'answer' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('question');

    const reader = bridge.getTranscriptReader();
    expect(reader).not.toBeNull();
    const timeline = reader!.getSnapshot();
    const reasoning = reasoningItems(timeline);
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]?.text).toBe('think hard');
    expect(reasoning[0]?.isStreaming).toBe(false);

    const kinds = timeline.map(item => item.kind);
    const reasoningIndex = kinds.indexOf('reasoning');
    const assistantIndex = kinds.indexOf('assistant_text');
    expect(reasoningIndex).toBeGreaterThan(-1);
    expect(assistantIndex).toBeGreaterThan(reasoningIndex);
  });

  it('keeps final reasoning metadata without deltas', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_final', content: 'answer', metadata: { reasoning: 'hidden chain' } };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('think first');

    const timeline = bridge.getTranscriptReader()!.getSnapshot();
    const reasoning = reasoningItems(timeline);
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]?.text).toBe('hidden chain');
  });
});
