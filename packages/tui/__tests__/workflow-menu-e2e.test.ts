/**
 * SFR-90: Workflow 菜单端到端集成测试
 *
 * 覆盖场景：
 * 1. createBridge + workflowCoordinator 接线：runWorkflow 正确处理事件流
 * 2. cancel 中断 Coordinator
 * 3. 三种模式的 routeWorkflowInput → bridge 动作一致性
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { WorkflowCoordinator } from '@deepreef/core/workflow-coordinator/coordinator.js';
import type { WorkflowEvent } from '@deepreef/core/workflow-coordinator/types.js';
import type { LoopEvent } from '@deepreef/core';
import { createBridge } from '../src/bridge.js';
import { routeWorkflowInput } from '../src/workflow-mode-router.js';
import type { BridgeState, TimelineItem } from '../src/bridge.js';
import type { WorkflowLifecycle } from '../src/workflow-mode-router.js';

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

function makeMockEngine() {
  let interrupted = false;
  return {
    interrupt: () => { interrupted = true; },
    get interrupted() { return interrupted; },
    submit: function* () {},
    respondPermission: () => {},
    rejectQuestion: () => {},
    respondQuestion: () => {},
  };
}

function makeMockCoordinator() {
  const events: Array<WorkflowEvent | LoopEvent> = [
    { type: 'phase_change', workflowId: 'wf-1', phase: 'supervisor_analyse', iteration: 1, timestamp: Date.now() },
    { role: 'reasoning_delta', content: 'supervisor reasoning' },
    { role: 'assistant_final', content: 'supervisor plan' },
    { type: 'phase_change', workflowId: 'wf-1', phase: 'worker_do', iteration: 1, timestamp: Date.now() },
    { role: 'assistant_final', content: 'worker result' },
    { type: 'completed', workflowId: 'wf-1', timestamp: Date.now() },
  ];
  const interruptedCalls: number[] = [];
  const startedGoals: string[] = [];
  let state: any = null;

  return {
    startWorkflow: (opts: any) => {
      startedGoals.push(opts.goal);
      state = { currentPhase: 'supervisor_analyse', iteration: 1 };
    },
    runWorkflow: async function* () {
      for (const evt of events) {
        yield evt;
      }
    },
    interrupt: () => { interruptedCalls.push(Date.now()); },
    reset: () => { state = null; },
    getState: () => state,
    startedGoals,
    interruptedCalls,
    events,
  };
}

describe('SFR-90: workflow e2e integration', () => {
  let setStateCalls: BridgeState;
  let engine: any;
  let coordinator: ReturnType<typeof makeMockCoordinator>;
  let bridge: ReturnType<typeof createBridge>;
  let phaseChanges: string[];

  beforeEach(() => {
    setStateCalls = initialState();
    engine = makeMockEngine();
    coordinator = makeMockCoordinator();
    phaseChanges = [];
    const setState = (update: any) => {
      setStateCalls = typeof update === 'function' ? update(setStateCalls) : update;
    };
    bridge = createBridge(
      engine as any,
      setState,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator as unknown as WorkflowCoordinator,
    );
  });

  afterEach(() => {
    delete process.env.DEEPCODE_DELTA_FLUSH_MS;
  });

  it('scenario 1: runWorkflow emits phase_change events through callback', async () => {
    const phases: string[] = [];
    await bridge.runWorkflow('test goal', (phase, iteration, finalStatus) => {
      if (finalStatus) {
        phases.push(`final:${finalStatus}`);
        return;
      }
      phases.push(`${phase}:${iteration}`);
    });

    expect(phases).toContain('supervisor_analyse:1');
    expect(phases).toContain('worker_do:1');
    expect(phases).toContain('final:completed');
    expect(coordinator.startedGoals).toContain('test goal');
  });

  it('scenario 2: cancel interrupts coordinator', async () => {
    bridge.cancel();

    expect(coordinator.interruptedCalls.length).toBe(1);
    expect(engine.interrupted).toBe(true);
  });

  it('scenario 3: routeWorkflowInput + bridge mode consistency', () => {
    const lifecycle: WorkflowLifecycle = { status: 'running', workflowId: 'wf-1' };
    const route = routeWorkflowInput({
      mode: 'loop',
      lifecycle,
      activeRole: 'supervisor',
      input: 'do something',
      inputKind: 'text',
    });
    expect(route.type).toBe('workflow_instruction');
    expect(route).toEqual({ type: 'workflow_instruction', content: 'do something' });
  });

  it('scenario 4: routeWorkflowInput start_workflow when lifecycle is awaiting_goal', () => {
    const route = routeWorkflowInput({
      mode: 'loop',
      lifecycle: { status: 'awaiting_goal' },
      activeRole: 'supervisor',
      input: 'my goal',
      inputKind: 'text',
    });
    expect(route.type).toBe('start_workflow');
    expect(route).toEqual({ type: 'start_workflow', goal: 'my goal' });
  });

  it('scenario 5: loop preserves supervisor and worker structured output in legacy timeline', async () => {
    await bridge.runWorkflow('test goal');

    const reasoning = setStateCalls.timeline.find(item => item.kind === 'reasoning');
    const texts = setStateCalls.timeline.filter(item => item.kind === 'assistant_text');

    expect(reasoning).toMatchObject({ kind: 'reasoning', text: 'supervisor reasoning', role: 'supervisor' });
    expect(texts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant_text', text: 'supervisor plan', role: 'supervisor' }),
      expect.objectContaining({ kind: 'assistant_text', text: 'worker result', role: 'worker' }),
    ]));
  });

  it('scenario 6: subagent mode is passed to DualAgentRuntime', async () => {
    const sent: any[] = [];
    const dualRuntime = {
      sendDirect: async function* (options: any) {
        sent.push(options);
        yield { role: 'done' };
      },
      interruptRole: () => {},
    };
    const setState = (update: any) => {
      setStateCalls = typeof update === 'function' ? update(setStateCalls) : update;
    };
    const modeBridge = createBridge(engine as any, setState, undefined, undefined, undefined, dualRuntime as any);

    await modeBridge.submit('delegate this', false, 'supervisor', 'subagent');

    expect(sent).toEqual([{ role: 'supervisor', input: 'delegate this', mode: 'subagent' }]);
  });

  it('scenario 7: subagent worker events keep their worker role in the shared timeline', async () => {
    const orchestrationEvents: any[] = [];
    const dualRuntime = {
      sendDirect: async function* () {
        yield { role: 'assistant_final', content: 'delegating' };
        yield {
          role: 'orchestration',
          orchestration: {
            kind: 'worker_upsert',
            worker: { id: 'worker-1', modelTarget: 'default', status: 'running', elapsedMs: 1 },
          },
        };
        yield { role: 'reasoning_delta', content: 'worker reasoning', metadata: { agentRole: 'worker' } };
        yield { role: 'assistant_final', content: 'worker result', metadata: { agentRole: 'worker' } };
        yield { role: 'assistant_final', content: 'supervisor summary' };
      },
      interruptRole: () => {},
    };
    const setState = (update: any) => {
      setStateCalls = typeof update === 'function' ? update(setStateCalls) : update;
    };
    const modeBridge = createBridge(
      engine as any,
      setState,
      undefined,
      undefined,
      { apply: (event: any) => orchestrationEvents.push(event) } as any,
      dualRuntime as any,
    );

    await modeBridge.submit('delegate this', false, 'supervisor', 'subagent');

    expect(setStateCalls.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant_text', text: 'delegating', role: 'supervisor' }),
      expect.objectContaining({ kind: 'reasoning', text: 'worker reasoning', role: 'worker' }),
      expect.objectContaining({ kind: 'assistant_text', text: 'worker result', role: 'worker' }),
      expect.objectContaining({ kind: 'assistant_text', text: 'supervisor summary', role: 'supervisor' }),
    ]));
    expect(orchestrationEvents).toEqual([
      expect.objectContaining({ kind: 'worker_upsert', worker: expect.objectContaining({ id: 'worker-1', status: 'running' }) }),
    ]);
  });
});
