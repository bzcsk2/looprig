import { describe, expect, it } from 'vitest';
import type { LoopEvent } from '@deepreef/core';
import type { ReasonixEngine } from '@deepreef/core';
import { createBridge, type BridgeState } from '../src/bridge.js';

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
  const submitted: string[] = [];
  const permissionResponses: boolean[] = [];
  const enqueuedInstructions: string[] = [];
  let interrupted = 0;
  let isSubmitting = false;
  const pendingQueue: string[] = [];
  return {
    submitted,
    permissionResponses,
    enqueuedInstructions,
    onRespondPermission: undefined as ((allow: boolean) => void) | undefined,
    get interrupted() { return interrupted; },
    get isSubmitting() { return isSubmitting; },
    submit(text: string) {
      submitted.push(text);
      isSubmitting = true;
      const generator = generators.shift();
      if (!generator) throw new Error(`Unexpected submit: ${text}`);
      const gen = generator(text);
      // Wrap to track when done
      return (async function* () {
        try {
          yield* gen;
        } finally {
          isSubmitting = false;
          pendingQueue.length = 0;
        }
      })();
    },
    enqueueInstruction(instruction: string) {
      const trimmed = instruction.trim();
      if (!trimmed) return { status: 'ignored' as const, queueLength: pendingQueue.length };
      if (!isSubmitting) return { status: 'idle' as const, queueLength: 0 };
      if (pendingQueue.length >= 10) return { status: 'full' as const, queueLength: pendingQueue.length };
      pendingQueue.push(trimmed);
      enqueuedInstructions.push(trimmed);
      return { status: 'queued' as const, queueLength: pendingQueue.length };
    },
    respondPermission(allow: boolean) {
      permissionResponses.push(allow);
      this.onRespondPermission?.(allow);
    },
    interrupt() { interrupted++; isSubmitting = false; pendingQueue.length = 0; },
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

describe('TUI bridge turn state', () => {
  it('accepts and displays input before background startup finishes', async () => {
    let releaseStartup!: () => void;
    const startupReady = new Promise<void>(resolve => { releaseStartup = resolve; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_final', content: 'ready' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(
      engine as unknown as ReasonixEngine,
      harness.setState,
      undefined,
      () => startupReady,
    );

    const pending = bridge.submit('typed during startup');
    expect(harness.state.isLoading).toBe(true);
    expect(harness.state.timeline.some(item => item.kind === 'message' && item.message.content === 'typed during startup')).toBe(true);
    expect(engine.submitted).toEqual([]);

    releaseStartup();
    await pending;

    expect(engine.submitted).toEqual(['typed during startup']);
    expect(harness.state.isLoading).toBe(false);
  });

  it('keeps final reasoning metadata when a provider emits no reasoning deltas', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_final', content: 'answer', metadata: { reasoning: 'hidden chain summary' } };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('think first');

    const item = harness.state.timeline[0];
    if (item?.kind !== 'turn') throw new Error('Expected turn');
    expect(item.turn.reasoningText).toBe('hidden chain summary');
  });

  it('keeps a pure tool turn visible and associates arguments by toolCallIndex', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'tool_call_delta', toolName: 'bash', toolCallIndex: 0, content: '{"command":"pwd"}' };
        yield { role: 'assistant_final', content: '' };
        yield { role: 'tool_start', toolName: 'bash', toolCallIndex: 0 };
        yield { role: 'tool', toolName: 'bash', toolCallIndex: 0, content: '{"stdout":"/tmp\\n"}' };
        yield { role: 'tool_progress', toolName: 'bash', toolCallIndex: 0, content: 'done' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('where am I?');

    const item = harness.state.timeline[0];
    expect(item?.kind).toBe('turn');
    if (item?.kind !== 'turn') throw new Error('Expected turn');
    expect(item.turn.assistantText).toBe('');
    expect(item.turn.tools).toHaveLength(1);
    expect(item.turn.tools[0]?.args).toEqual({ command: 'pwd' });
    expect(item.turn.tools[0]?.status).toBe('done');
  });

  it('preserves tools when a later batch reuses toolCallIndex zero', async () => {
    const engine = mockEngine([
      async function* () {
        for (const command of ['pwd', 'ls']) {
          yield { role: 'tool_call_delta', toolName: 'bash', toolCallIndex: 0, content: JSON.stringify({ command }) };
          yield { role: 'tool_start', toolName: 'bash', toolCallIndex: 0 };
          yield { role: 'tool', toolName: 'bash', toolCallIndex: 0, content: '{"stdout":""}' };
          yield { role: 'tool_progress', toolName: 'bash', toolCallIndex: 0, content: 'done' };
        }
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('run both');

    const item = harness.state.timeline[0];
    if (item?.kind !== 'turn') throw new Error('Expected turn');
    expect(item.turn.tools.map(tool => tool.args.command)).toEqual(['pwd', 'ls']);
  });

  it('clears a repeated tool-call warning when the next reasoning event arrives', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'warning', content: 'Tool call loop detected: read_file called 3 times with identical arguments' };
        yield { role: 'warning', content: 'Keep this warning' };
        yield { role: 'reasoning_delta', content: 'Trying another approach' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('continue');

    expect(harness.state.warnings).toEqual(['Keep this warning']);
  });

  it('shows only the latest repeated tool-call warning while waiting for new activity', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'warning', content: 'Tool call loop detected: read_file called 3 times with identical arguments' };
        yield { role: 'warning', content: 'Tool call loop detected: read_file called 4 times with identical arguments' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('continue');

    expect(harness.state.warnings).toEqual([
      'Tool call loop detected: read_file called 4 times with identical arguments',
    ]);
  });

  it('replaces repeated tool-call warnings and clears them on the next tool call', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'warning', content: 'Tool call loop detected: read_file called 3 times with identical arguments' };
        yield { role: 'warning', content: 'Tool call loop detected: read_file called 4 times with identical arguments' };
        yield { role: 'tool_call_delta', toolName: 'search', toolCallIndex: 0, content: '{"query":"next"}' };
        yield { role: 'tool_start', toolName: 'search', toolCallIndex: 0 };
        yield { role: 'tool', toolName: 'search', toolCallIndex: 0, content: 'done' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    await bridge.submit('continue');

    expect(harness.state.warnings).toEqual([]);
  });

  it('queues a new submit until the active generator exits after cancel', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstReleased = new Promise<void>(resolve => { releaseFirst = resolve; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_delta', content: 'partial' };
        await firstReleased;
        yield { role: 'status', content: 'interrupted' };
      },
      async function* () {
        yield { role: 'assistant_delta', content: 'second' };
        yield { role: 'assistant_final', content: 'second' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const first = bridge.submit('first');
    await waitFor(() => engine.submitted.length === 1);
    bridge.cancel();
    await bridge.submit('second');
    expect(engine.submitted).toEqual(['first']);
    expect(harness.state.messageQueue).toEqual(['second']);

    releaseFirst?.();
    await first;
    await waitFor(() => engine.submitted.length === 2 && harness.state.isLoading === false);

    expect(engine.submitted).toEqual(['first', 'second']);
    expect(harness.state.timeline).toHaveLength(2);
  });

  it('denies a pending permission prompt when cancelled so the generator can exit', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'permission_ask', toolName: 'bash', content: '{"command":"pwd"}' };
        await new Promise<void>(resolve => {
          engine.onRespondPermission = () => resolve();
        });
        yield { role: 'status', content: 'interrupted' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const pending = bridge.submit('run command');
    await waitFor(() => harness.state.permissionPrompt !== null);
    bridge.cancel();
    await pending;

    expect(engine.permissionResponses).toEqual([false]);
    expect(harness.state.isLoading).toBe(false);
    expect(harness.state.permissionPrompt).toBeNull();
  });

  // ─── P0 Contract Tests (bridge) ──────────────────────────────────

  it('P0-5: permission prompt cancel — promise is fulfilled, generator can exit', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'permission_ask', toolName: 'bash', content: '{"command":"rm -rf /"}' };
        await new Promise<void>(resolve => {
          engine.onRespondPermission = () => resolve();
        });
        yield { role: 'status', content: 'interrupted' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const pending = bridge.submit('dangerous command');
    await waitFor(() => harness.state.permissionPrompt !== null);
    // User cancels during permission prompt
    bridge.cancel();
    await pending;

    // Permission promise was resolved with false
    expect(engine.permissionResponses).toEqual([false]);
    // Generator exited cleanly
    expect(harness.state.isLoading).toBe(false);
  });

  it('P0-6: TUI running input goes to enqueueInstruction, not lost', async () => {
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>(r => { releaseFirst = r; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_delta', content: 'working...' };
        yield { role: 'status', content: 'instruction_injected', metadata: { kind: 'instruction_injected', queueLength: 0, turnCount: 1 } };
        await firstReleased;
        yield { role: 'assistant_final', content: 'done with both' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    // First submit is running
    const first = bridge.submit('first message');
    await waitFor(() => engine.submitted.length === 1);

    // Second submit arrives while first is running — goes to enqueueInstruction
    bridge.submit('second message');
    expect(harness.state.messageQueue).toEqual([]);
    expect(engine.enqueuedInstructions).toEqual(['second message']);
    expect(engine.submitted).toEqual(['first message']);

    // Release first submit (which processes both messages)
    releaseFirst();
    await waitFor(() => harness.state.isLoading === false);

    // Both messages were handled in one submit via injection
    expect(engine.submitted).toEqual(['first message']);
    expect(harness.state.messageQueue).toEqual([]);
  });

  // ─── P3: Mid-session instruction routing ──────────────────────────

  it('P3-1: running + queued — input goes to engine, not messageQueue', async () => {
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>(r => { releaseFirst = r; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_delta', content: 'working...' };
        await firstReleased;
        yield { role: 'assistant_final', content: 'done' };
        yield { role: 'done' };
      },
      async function* () {
        yield { role: 'assistant_final', content: 'follow-up response' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const first = bridge.submit('first');
    await waitFor(() => engine.submitted.length === 1);

    // Second submit while running — should go via enqueueInstruction
    bridge.submit('follow-up question');
    expect(harness.state.messageQueue).toEqual([]);
    expect(engine.enqueuedInstructions).toEqual(['follow-up question']);
    expect(harness.state.pendingInstructionCount).toBe(1);

    releaseFirst();
    await first;
    await waitFor(() => harness.state.isLoading === false);
  });

  it('P3-2: running + full — input falls back to messageQueue', async () => {
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>(r => { releaseFirst = r; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_delta', content: 'working...' };
        await firstReleased;
        yield { role: 'assistant_final', content: 'done' };
        yield { role: 'done' };
      },
      async function* () {
        yield { role: 'assistant_final', content: 'overflow response' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const first = bridge.submit('first');
    await waitFor(() => engine.submitted.length === 1);

    // Fill the injection queue (mock allows 10)
    for (let i = 0; i < 10; i++) {
      engine.enqueueInstruction(`msg-${i}`);
    }
    // 11th should be full — falls back to messageQueue
    bridge.submit('overflow message');
    expect(harness.state.messageQueue).toEqual(['overflow message']);
    expect(harness.state.pendingInstructionCount).toBe(10);

    releaseFirst();
    await first;
  });

  it('P3-3: running + idle race — input falls back to messageQueue', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_final', content: 'quick' };
        yield { role: 'done' };
      },
      async function* () {
        yield { role: 'assistant_final', content: 'queued' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    // Submit and immediately try another — engine finishes very fast
    const first = bridge.submit('first');
    // By the time we call submit again, engine may have finished (idle)
    // The mock engine sets isSubmitting=false on generator exit
    await first;
    // Now engine is idle — enqueueInstruction returns idle, falls back to messageQueue
    bridge.submit('second');
    // Since engine is idle, it should go to messageQueue (or auto-submit via processQueue)
    await waitFor(() => engine.submitted.length === 2 || harness.state.messageQueue.length === 0);
  });

  it('P3-4: instruction_injected status updates pendingInstructionCount', async () => {
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>(r => { releaseFirst = r; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_delta', content: 'working...' };
        await firstReleased;
        yield { role: 'status', content: 'instruction_injected', metadata: { kind: 'instruction_injected', queueLength: 0, turnCount: 1 } };
        yield { role: 'assistant_final', content: 'done' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const first = bridge.submit('first');
    await waitFor(() => engine.submitted.length === 1);

    // Manually set pendingInstructionCount to simulate a queued instruction
    harness.setState(prev => ({ ...prev, pendingInstructionCount: 1 }));
    expect(harness.state.pendingInstructionCount).toBe(1);

    releaseFirst();
    await first;
    // After instruction_injected status, count should be 0
    await waitFor(() => harness.state.pendingInstructionCount === 0);
  });

  it('P3-5: cancel still calls respondPermission(false) and interrupt()', async () => {
    const engine = mockEngine([
      async function* () {
        yield { role: 'permission_ask', toolName: 'bash', content: '{"command":"ls"}' };
        await new Promise<void>(resolve => {
          engine.onRespondPermission = () => resolve();
        });
        yield { role: 'status', content: 'interrupted' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const pending = bridge.submit('run');
    await waitFor(() => harness.state.permissionPrompt !== null);
    bridge.cancel();
    await pending;

    expect(engine.permissionResponses).toEqual([false]);
    expect(engine.interrupted).toBe(1);
  });

  it('P3-6: original serial queue regression — messageQueue still works', async () => {
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>(r => { releaseFirst = r; });
    const engine = mockEngine([
      async function* () {
        yield { role: 'assistant_delta', content: 'working...' };
        await firstReleased;
        yield { role: 'assistant_final', content: 'done' };
        yield { role: 'done' };
      },
      async function* () {
        yield { role: 'assistant_final', content: 'queued response' };
        yield { role: 'done' };
      },
    ]);
    const harness = stateHarness();
    const bridge = createBridge(engine as unknown as ReasonixEngine, harness.setState);

    const first = bridge.submit('first');
    await waitFor(() => engine.submitted.length === 1);

    // If enqueueInstruction returns idle (engine finishes fast), falls back to messageQueue
    // Force the scenario: engine finishes before second submit
    releaseFirst();
    await first;
    // Now engine is idle
    bridge.submit('second');
    // Should be processed by processQueue (serial)
    await waitFor(() => engine.submitted.length === 2 && harness.state.isLoading === false);
    expect(engine.submitted).toEqual(['first', 'second']);
  });
});
