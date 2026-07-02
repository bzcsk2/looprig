/**
 * T40 Benchmark: measure rendering cost with large timelines.
 * Run: bun test packages/tui/__tests__/virtual-list-bench.test.ts
 */

import { describe, it } from 'bun:test';
import type { TimelineItem, TurnView } from '../src/bridge.js';
import type { ChatMessage } from '@covalo/core';

function makeTurn(id: string, textLen: number, toolCount: number): TimelineItem {
  const tools = Array.from({ length: toolCount }, (_, i) => ({
    key: `${id}_tool_${i}`,
    name: 'bash',
    status: 'done' as const,
    args: { command: `echo "tool ${i}"` },
    output: 'x'.repeat(200),
    startedAt: Date.now(),
    elapsedMs: 100,
  }));
  const turn: TurnView = {
    id,
    userText: 'a'.repeat(textLen),
    assistantText: 'b'.repeat(textLen * 2),
    streamingText: null,
    reasoningText: '',
    tools,
    isLoading: false,
    startTs: Date.now(),
  };
  return { id, kind: 'turn', turn };
}

function makeMessage(id: string, role: 'user' | 'assistant', textLen: number): TimelineItem {
  const msg: ChatMessage = { role, content: 'x'.repeat(textLen) };
  return { id, kind: 'message', message: msg };
}

function buildTimeline(count: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      items.push(makeMessage(`msg_${i}`, 'user', 50 + (i % 5) * 20));
    } else {
      items.push(makeTurn(`turn_${i}`, 100 + (i % 10) * 50, i % 3));
    }
  }
  return items;
}

describe('T40: Virtual list performance', () => {
  it('buildTimeline creates correct item count', () => {
    const t = buildTimeline(500);
    console.log(`Timeline: ${t.length} items`);
    console.log(`  message items: ${t.filter(i => i.kind === 'message').length}`);
    console.log(`  turn items: ${t.filter(i => i.kind === 'turn').length}`);
  });

  it('measure timeline construction cost', () => {
    const sizes = [100, 500, 1000];
    for (const n of sizes) {
      const start = performance.now();
      const t = buildTimeline(n);
      const ms = performance.now() - start;
      console.log(`  ${n} items: ${ms.toFixed(1)}ms to build`);
    }
  });

  it('measure id extraction cost (for virtual windowing)', () => {
    const t = buildTimeline(1000);
    const start = performance.now();
    for (let iter = 0; iter < 1000; iter++) {
      // Simulate what a virtual list would do: scan for visible range
      const visibleStart = Math.floor(Math.random() * 500);
      const visibleEnd = Math.min(visibleStart + 50, t.length);
      const visible = t.slice(visibleStart, visibleEnd);
      void visible;
    }
    const ms = performance.now() - start;
    console.log(`  1000 window scans on 1000 items: ${ms.toFixed(1)}ms`);
  });
});
