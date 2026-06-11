/**
 * UI Store：管理界面状态（当前页面、焦点等）
 *
 * 设计原则：
 * - 与业务数据（TuiStore）分离，只管理 UI 状态
 * - 页面切换通过键盘快捷键（1-6）触发
 * - 中文注释：页面 ID 与方案 4.2 一致
 */

import { createStore } from "./create-store.js";

/** 一级页面（与方案 4.2 对应） */
export type PageId = "chat" | "orchestration" | "workers" | "supervisor" | "loop" | "system";

export interface UiState {
  /** 当前页面 */
  currentPage: PageId;
  /** 当前选中的 Worker ID（用于详情页） */
  selectedWorkerId?: string;
  /** 当前选中的 Supervisor ID */
  selectedSupervisorId?: string;
  /** 是否显示详情页 */
  showDetail: boolean;
}

const initialUiState: UiState = {
  currentPage: "orchestration",  // 默认显示 Orchestration 总览
  showDetail: false,
};

export const uiStore = createStore<UiState>(initialUiState);

/** 页面切换 */
export function switchPage(page: PageId): void {
  uiStore.setState({
    currentPage: page,
    showDetail: false,
    selectedWorkerId: undefined,
    selectedSupervisorId: undefined,
  });
}

/** 选中 Worker 并显示详情 */
export function selectWorker(workerId: string): void {
  uiStore.setState({
    selectedWorkerId: workerId,
    showDetail: true,
  });
}

/** 选中 Supervisor 并显示详情 */
export function selectSupervisor(supervisorId: string): void {
  uiStore.setState({
    selectedSupervisorId: supervisorId,
    showDetail: true,
  });
}

/** 关闭详情页返回列表 */
export function closeDetail(): void {
  uiStore.setState({
    showDetail: false,
    selectedWorkerId: undefined,
    selectedSupervisorId: undefined,
  });
}

/** 页面名称映射（用于显示） */
export const pageNames: Record<PageId, string> = {
  chat: "Chat",
  orchestration: "Orchestration",
  workers: "Workers",
  supervisor: "Supervisor",
  loop: "Loop",
  system: "System",
};

/** 快捷键映射（与方案一致） */
export const pageKeyMap: Record<string, PageId> = {
  "1": "chat",
  "2": "orchestration",
  "3": "workers",
  "4": "supervisor",
  "5": "loop",
  "6": "system",
};
