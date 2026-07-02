/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * React context and hook for subscribing to OrchestrationStore state.
 * Provides focused subscriptions to avoid unnecessary re-renders.
 */

import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { OrchestrationStore, type OrchestrationState, type LoopPhase } from '../../store/orchestration-store.js';
import type { WorkerSnapshot, SupervisorSnapshot } from '@covalo/core';
import type { WorkerDisplayData, WorkerStatus } from '../agents/AgentGroupDisplay.js';

/**
 * Supervisor 显示数据（原 OrchestrationSummary 定义，面板移除后迁移至此）。
 */
export interface SupervisorDisplayData {
  id: string;
  modelName: string;
  status: 'reviewing' | 'idle' | 'cooldown' | 'unavailable';
  reviewingWorkerId?: string;
  lastAdvice?: string;
}

/** Loop 阶段（与 store 的 LoopPhase 对齐，保留以兼容历史 hook 签名） */
export type SummaryLoopPhase = LoopPhase;

const OrchestrationStoreContext = createContext<OrchestrationStore | null>(null);

export function useOrchestrationStore(): OrchestrationStore {
  const store = useContext(OrchestrationStoreContext);
  if (!store) {
    throw new Error('useOrchestrationStore must be used within OrchestrationStoreProvider');
  }
  return store;
}

export function OrchestrationStoreProvider({
  store,
  children,
}: {
  store: OrchestrationStore;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <OrchestrationStoreContext.Provider value={store}>
      {children}
    </OrchestrationStoreContext.Provider>
  );
}

/**
 * Subscribe to the full orchestration snapshot.
 */
export function useOrchestrationSnapshot(): OrchestrationState {
  const store = useOrchestrationStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
}

/**
 * Convert WorkerSnapshot to WorkerDisplayData for OrchestrationSummary.
 */
function workerToDisplay(worker: WorkerSnapshot): WorkerDisplayData {
  return {
    id: worker.id,
    modelName: worker.modelTarget,
    status: worker.status as WorkerStatus,
    currentTask: worker.currentTask,
    duration: worker.elapsedMs > 0 ? `${Math.round(worker.elapsedMs / 1000)}s` : undefined,
  };
}

/**
 * Convert SupervisorSnapshot to SupervisorDisplayData.
 */
function supervisorToDisplay(supervisor: SupervisorSnapshot): SupervisorDisplayData {
  return {
    id: supervisor.id,
    modelName: supervisor.modelTarget,
    status: supervisor.status === 'disabled' ? 'idle'
      : supervisor.status === 'queued' ? 'idle'
      : supervisor.status as SupervisorDisplayData['status'],
    reviewingWorkerId: supervisor.reviewingWorkerId,
  };
}

/**
 * Convert Core LoopPhase to Summary LoopPhase.
 */
function toSummaryPhase(phase: LoopPhase): SummaryLoopPhase {
  return phase as SummaryLoopPhase;
}

/**
 * Subscribe to workers data for OrchestrationSummary.
 */
export function useOrchestrationWorkers(): WorkerDisplayData[] {
  const state = useOrchestrationSnapshot();
  return Array.from(state.workers.values()).map(workerToDisplay);
}

/**
 * Subscribe to supervisors data for OrchestrationSummary.
 */
export function useOrchestrationSupervisors(): SupervisorDisplayData[] {
  const state = useOrchestrationSnapshot();
  return Array.from(state.supervisors.values()).map(supervisorToDisplay);
}

/**
 * Subscribe to loop state for OrchestrationSummary.
 */
export function useOrchestrationLoop(): { phase: SummaryLoopPhase; attempt: number } {
  const state = useOrchestrationSnapshot();
  return {
    phase: toSummaryPhase(state.loop.phase),
    attempt: state.loop.attempt,
  };
}

/**
 * Subscribe to worker count (for compact display).
 */
export function useOrchestrationWorkerCount(): number {
  const state = useOrchestrationSnapshot();
  return state.workers.size;
}
