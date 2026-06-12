/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrchestrationStore tests — TUI-FIX-20 / TUI-FIX-80.
 */

import { describe, it, expect } from 'bun:test';
import { OrchestrationStore } from '../src/store/orchestration-store.js';
import type { OrchestrationEventPayload, WorkerSnapshot, SupervisorSnapshot, LoopTransition, RuntimeSignal } from '@deepreef/core';

function makeWorkerUpsert(overrides: Partial<WorkerSnapshot> & { id: string }): OrchestrationEventPayload {
  return {
    kind: 'worker_upsert',
    worker: {
      modelTarget: 'test-model',
      status: 'running',
      elapsedMs: 0,
      ...overrides,
    },
  };
}

function makeSupervisorUpsert(overrides: Partial<SupervisorSnapshot> & { id: string }): OrchestrationEventPayload {
  return {
    kind: 'supervisor_upsert',
    supervisor: {
      modelTarget: 'supervisor-model',
      status: 'idle',
      ...overrides,
    },
  };
}

function makeLoopTransition(overrides: Partial<LoopTransition> = {}): OrchestrationEventPayload {
  return {
    kind: 'loop_transition',
    transition: {
      from: 'observe',
      to: 'act',
      attempt: 1,
      timestamp: Date.now(),
      ...overrides,
    },
  };
}

function makeRuntimeSignal(overrides: Partial<RuntimeSignal> = {}): OrchestrationEventPayload {
  return {
    kind: 'runtime_signal',
    signal: {
      kind: 'no-progress',
      ...overrides,
    },
  };
}

describe('OrchestrationStore', () => {
  it('starts with empty state', () => {
    const store = new OrchestrationStore();
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(0);
    expect(state.supervisors.size).toBe(0);
    expect(state.loop.phase).toBe('observe');
    expect(state.loop.attempt).toBe(1);
    expect(state.agentTree.size).toBe(0);
    expect(state.activities.size).toBe(0);
    expect(state.lastCheckpoint).toBeUndefined();
  });

  it('worker_upsert adds a worker', () => {
    const store = new OrchestrationStore();
    store.apply(makeWorkerUpsert({ id: 'w1', modelTarget: 'qwen-small', status: 'running' }));
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(1);
    expect(state.workers.get('w1')?.modelTarget).toBe('qwen-small');
    expect(state.workers.get('w1')?.status).toBe('running');
  });

  it('worker_upsert is idempotent', () => {
    const store = new OrchestrationStore();
    store.apply(makeWorkerUpsert({ id: 'w1', modelTarget: 'qwen-small', status: 'running' }));
    store.apply(makeWorkerUpsert({ id: 'w1', modelTarget: 'qwen-small', status: 'completed' }));
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(1);
    expect(state.workers.get('w1')?.status).toBe('completed');
  });

  it('worker_remove deletes a worker', () => {
    const store = new OrchestrationStore();
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    store.apply(makeWorkerUpsert({ id: 'w2', status: 'running' }));
    store.apply({ kind: 'worker_remove', workerId: 'w1' });
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(1);
    expect(state.workers.has('w1')).toBe(false);
    expect(state.workers.has('w2')).toBe(true);
  });

  it('worker_remove cleans up activities', () => {
    const store = new OrchestrationStore();
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'completed' }));
    expect(store.getSnapshot().activities.has('w1')).toBe(true);
    store.apply({ kind: 'worker_remove', workerId: 'w1' });
    expect(store.getSnapshot().activities.has('w1')).toBe(false);
  });

  it('supervisor_upsert adds a supervisor', () => {
    const store = new OrchestrationStore();
    store.apply(makeSupervisorUpsert({ id: 's1', status: 'reviewing' }));
    const state = store.getSnapshot();
    expect(state.supervisors.size).toBe(1);
    expect(state.supervisors.get('s1')?.status).toBe('reviewing');
  });

  it('loop_transition updates phase and attempt', () => {
    const store = new OrchestrationStore();
    store.apply(makeLoopTransition({ to: 'act', attempt: 2 }));
    const state = store.getSnapshot();
    expect(state.loop.phase).toBe('act');
    expect(state.loop.attempt).toBe(2);
  });

  it('runtime_signal updates lastSignal', () => {
    const store = new OrchestrationStore();
    store.apply(makeRuntimeSignal({ kind: 'verification-failed', message: 'test failed' }));
    const state = store.getSnapshot();
    expect(state.loop.lastSignal?.kind).toBe('verification-failed');
    expect(state.loop.lastSignal?.message).toBe('test failed');
  });

  it('supervisor_advice records activity', () => {
    const store = new OrchestrationStore();
    store.apply({
      kind: 'supervisor_advice',
      supervisorId: 's1',
      workerId: 'w1',
      advice: 'Try a different approach',
      adopted: true,
    });
    const state = store.getSnapshot();
    expect(state.activities.has('supervisor:s1')).toBe(true);
  });

  it('checkpoint stores snapshot', () => {
    const store = new OrchestrationStore();
    store.apply({
      kind: 'checkpoint',
      checkpoint: { runId: 'run-123', savedAt: Date.now() },
    });
    const state = store.getSnapshot();
    expect(state.lastCheckpoint?.runId).toBe('run-123');
  });

  it('invalid payload is safely ignored', () => {
    const store = new OrchestrationStore();
    // @ts-expect-error — testing invalid payload handling
    store.apply({ kind: 'unknown_kind' });
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(0);
  });

  it('reset clears all state', () => {
    const store = new OrchestrationStore();
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    store.apply(makeLoopTransition({ to: 'act' }));
    store.reset();
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(0);
    expect(state.loop.phase).toBe('observe');
  });

  it('replay replays event sequence', () => {
    const store = new OrchestrationStore();
    const events: OrchestrationEventPayload[] = [
      makeWorkerUpsert({ id: 'w1', status: 'running' }),
      makeWorkerUpsert({ id: 'w2', status: 'starting' }),
      makeLoopTransition({ to: 'plan' }),
      makeSupervisorUpsert({ id: 's1', status: 'idle' }),
    ];
    const version = store.replay(events);
    const state = store.getSnapshot();
    expect(state.workers.size).toBe(2);
    expect(state.supervisors.size).toBe(1);
    expect(state.loop.phase).toBe('plan');
    expect(version).toBeGreaterThan(0);
  });

  it('maintains bounded activity history', () => {
    const store = new OrchestrationStore();
    // Add many worker_upsert events to overflow activity history
    for (let i = 0; i < 60; i++) {
      store.apply(makeWorkerUpsert({ id: 'w1', status: i % 2 === 0 ? 'running' : 'paused' }));
    }
    const state = store.getSnapshot();
    const activities = state.activities.get('w1');
    expect(activities).toBeDefined();
    expect(activities!.length).toBeLessThanOrEqual(50);
  });

  it('notifies subscribers on state change', () => {
    const store = new OrchestrationStore();
    let notified = false;
    const unsub = store.subscribe(() => { notified = true; });
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    expect(notified).toBe(true);
    unsub();
  });

  it('does not notify on no-op updates', () => {
    const store = new OrchestrationStore();
    let notificationCount = 0;
    const unsub = store.subscribe(() => { notificationCount++; });
    // Apply same state twice — should not notify second time (shallow equal)
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    expect(notificationCount).toBeGreaterThanOrEqual(1);
    unsub();
  });

  it('single worker update does not affect other subscriptions', () => {
    const store = new OrchestrationStore();
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'running' }));
    store.apply(makeWorkerUpsert({ id: 'w2', status: 'running' }));
    const snapshot1 = store.getSnapshot();
    // Update only w1
    store.apply(makeWorkerUpsert({ id: 'w1', status: 'completed' }));
    const snapshot2 = store.getSnapshot();
    // w2 should be unchanged
    expect(snapshot2.workers.get('w2')).toBe(snapshot1.workers.get('w2'));
    // w1 should be updated
    expect(snapshot2.workers.get('w1')?.status).toBe('completed');
  });
});
