/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrchestrationStore — 管理多 Agent 编排状态（Workers / Supervisors / Loop）。
 *
 * 基于 SubscribeStore 模式，支持 focused subscription 和事件 replay。
 * Bridge 将 Core 的 orchestration 事件转发至此 Store，组件通过 useSyncExternalStore 消费。
 */

import type { OrchestrationEventPayload, WorkerSnapshot, SupervisorSnapshot, LoopTransition, RuntimeSignal, AgentTreeNode, CheckpointSnapshot } from '@deepreef/core';
import { SubscribeStore } from './subscribe-store.js';

/** Loop phase — 与 Core LoopPhase 对齐 */
export type LoopPhase =
  | 'observe' | 'plan' | 'act' | 'verify' | 'reflect'
  | 'retry' | 'paused' | 'done' | 'failed';

/** Agent 活动事件（用于 AgentProgressDisplay） */
export interface AgentActivityEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'state_change';
  content: string;
  toolName?: string;
  status?: 'running' | 'completed' | 'error' | 'cancelled';
  ts: number;
}

/** Orchestration 完整快照 */
export interface OrchestrationState {
  workers: ReadonlyMap<string, WorkerSnapshot>;
  supervisors: ReadonlyMap<string, SupervisorSnapshot>;
  loop: {
    phase: LoopPhase;
    attempt: number;
    lastSignal?: RuntimeSignal;
  };
  agentTree: ReadonlyMap<string, AgentTreeNode>;
  activities: ReadonlyMap<string, readonly AgentActivityEvent[]>;
  lastCheckpoint?: CheckpointSnapshot;
}

/** 单个 Worker 的活动历史（有界队列） */
const MAX_ACTIVITIES_PER_WORKER = 50;

function createInitialOrchestrationState(): OrchestrationState {
  return {
    workers: new Map(),
    supervisors: new Map(),
    loop: { phase: 'observe', attempt: 1 },
    agentTree: new Map(),
    activities: new Map(),
    lastCheckpoint: undefined,
  };
}

/**
 * OrchestrationStore — 管理编排状态的 SubscribeStore。
 *
 * 用法：
 * ```ts
 * const store = new OrchestrationStore();
 * store.apply(orchestrationEvent);
 * const snapshot = store.getSnapshot();
 * ```
 */
export class OrchestrationStore extends SubscribeStore<OrchestrationState> {
  constructor() {
    super(createInitialOrchestrationState());
  }

  /**
   * 应用单个编排事件，更新状态。
   * 非法 payload 安全忽略。
   */
  apply(payload: OrchestrationEventPayload): void {
    try {
      this.update(prev => this.reduce(prev, payload));
    } catch (err) {
      console.error('[OrchestrationStore] Ignored invalid payload:', err);
    }
  }

  /**
   * 重置 Store 为初始状态（Session 切换时调用）。
   */
  reset(): void {
    this.replace(createInitialOrchestrationState());
  }

  /**
   * 批量回放事件序列（用于测试和 session 恢复）。
   * 返回最终快照版本号。
   */
  replay(events: OrchestrationEventPayload[]): number {
    for (const event of events) {
      this.apply(event);
    }
    return this.getVersion();
  }

  /**
   * 纯函数 reducer：输入当前状态 + 事件 → 输出新状态。
   */
  private reduce(prev: OrchestrationState, payload: OrchestrationEventPayload): OrchestrationState {
    switch (payload.kind) {
      case 'worker_upsert': {
        const nextWorkers = new Map(prev.workers);
        nextWorkers.set(payload.worker.id, payload.worker);
        // 记录活动
        const nextActivities = this.recordActivity(prev.activities, payload.worker.id, {
          type: 'state_change',
          content: `status: ${payload.worker.status}`,
          ts: Date.now(),
        });
        return { ...prev, workers: nextWorkers, activities: nextActivities };
      }

      case 'worker_remove': {
        if (payload.workerId === '*') {
          // Wildcard: clear all workers and activities
          return { ...prev, workers: new Map(), activities: new Map() };
        }
        const nextWorkers = new Map(prev.workers);
        nextWorkers.delete(payload.workerId);
        const nextActivities = new Map(prev.activities);
        nextActivities.delete(payload.workerId);
        return { ...prev, workers: nextWorkers, activities: nextActivities };
      }

      case 'supervisor_upsert': {
        const nextSupervisors = new Map(prev.supervisors);
        nextSupervisors.set(payload.supervisor.id, payload.supervisor);
        return { ...prev, supervisors: nextSupervisors };
      }

      case 'supervisor_advice': {
        // 记录 supervisor 活动
        const nextActivities = this.recordActivity(prev.activities, `supervisor:${payload.supervisorId}`, {
          type: 'state_change',
          content: `advice: ${payload.advice.slice(0, 100)}`,
          ts: Date.now(),
        });
        return { ...prev, activities: nextActivities };
      }

      case 'loop_transition': {
        const phase = payload.transition.to as LoopPhase;
        return {
          ...prev,
          loop: {
            phase,
            attempt: payload.transition.attempt,
            lastSignal: prev.loop.lastSignal,
          },
        };
      }

      case 'runtime_signal': {
        return {
          ...prev,
          loop: {
            ...prev.loop,
            lastSignal: payload.signal,
          },
        };
      }

      case 'agent_tree_upsert': {
        const nextTree = new Map(prev.agentTree);
        nextTree.set(payload.node.id, payload.node);
        return { ...prev, agentTree: nextTree };
      }

      case 'checkpoint': {
        return { ...prev, lastCheckpoint: payload.checkpoint };
      }

      default:
        return prev;
    }
  }

  /**
   * 记录单个 Agent 的活动事件，保持有界历史。
   */
  private recordActivity(
    activities: ReadonlyMap<string, readonly AgentActivityEvent[]>,
    agentId: string,
    event: AgentActivityEvent,
  ): ReadonlyMap<string, readonly AgentActivityEvent[]> {
    const nextActivities = new Map(activities);
    const existing = nextActivities.get(agentId) ?? [];
    const updated = [...existing, event];
    // 保持有界
    if (updated.length > MAX_ACTIVITIES_PER_WORKER) {
      nextActivities.set(agentId, updated.slice(-MAX_ACTIVITIES_PER_WORKER));
    } else {
      nextActivities.set(agentId, updated);
    }
    return nextActivities;
  }
}
