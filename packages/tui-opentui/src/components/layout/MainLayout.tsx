/**
 * MainLayout：主布局框架
 *
 * 结构（与方案 4.1 对应）：
 * - Header：品牌、页面切换提示
 * - 主内容区：根据 currentPage 显示不同页面
 * - Footer：快捷键提示
 *
 * 中文注释：flexDirection column 确保垂直布局
 */

import { Header } from "./Header.js";
import { Footer } from "./Footer.js";
import { OrchestrationDashboard } from "../dashboard/OrchestrationDashboard.js";
import { WorkerDetailView } from "../workers/WorkerDetailView.js";
import { SupervisorDetailView } from "../supervisor/SupervisorDetailView.js";
import { LoopDetailView } from "../loop/LoopDetailView.js";
import { colors } from "../../theme/colors.js";
import type { TuiState } from "../../store/types.js";
import type { PageId, UiState } from "../../store/ui-store.js";

export interface MainLayoutProps {
  tuiState: TuiState;
  uiState: UiState;
  onSwitchPage: (page: PageId) => void;
  onCloseDetail: () => void;
}

/** 纯函数组件：根据页面渲染内容 */
function renderPageContent(
  page: PageId,
  tuiState: TuiState,
  uiState: UiState,
  onCloseDetail: () => void
) {
  const terminalWidth = 120;

  switch (page) {
    case "chat":
      return (
        <text color={colors.fg.muted}>
          Chat 页面（TUI-OT-50 实现）
        </text>
      );

    case "orchestration":
    default:
      // 如果 showDetail 为 true，显示选中的详情页
      if (uiState.showDetail && uiState.selectedWorkerId) {
        const worker = tuiState.workers[uiState.selectedWorkerId];
        if (worker) {
          return (
            <WorkerDetailView
              worker={worker}
              workerIndex={Object.keys(tuiState.workers).indexOf(worker.id)}
              onClose={onCloseDetail}
            />
          );
        }
      }

      if (uiState.showDetail && uiState.selectedSupervisorId) {
        const supervisor = tuiState.supervisors[uiState.selectedSupervisorId];
        if (supervisor) {
          return (
            <SupervisorDetailView
              supervisor={supervisor}
              onClose={onCloseDetail}
            />
          );
        }
      }

      // 默认显示 Dashboard
      return (
        <OrchestrationDashboard
          terminalWidth={terminalWidth}
          state={tuiState}
        />
      );

    case "workers":
      if (uiState.showDetail && uiState.selectedWorkerId) {
        const worker = tuiState.workers[uiState.selectedWorkerId];
        if (worker) {
          return (
            <WorkerDetailView
              worker={worker}
              workerIndex={Object.keys(tuiState.workers).indexOf(worker.id)}
              onClose={onCloseDetail}
            />
          );
        }
      }
      return (
        <text color={colors.fg.muted}>
          Workers 列表（TODO）
        </text>
      );

    case "supervisor":
      if (uiState.showDetail && uiState.selectedSupervisorId) {
        const supervisor = tuiState.supervisors[uiState.selectedSupervisorId];
        if (supervisor) {
          return (
            <SupervisorDetailView
              supervisor={supervisor}
              onClose={onCloseDetail}
            />
          );
        }
      }
      return (
        <text color={colors.fg.muted}>
          Supervisor 列表（TODO）
        </text>
      );

    case "loop":
      return (
        <LoopDetailView
          loopState={tuiState.loop}
          onClose={onCloseDetail}
        />
      );

    case "system":
      return (
        <text color={colors.fg.muted}>
          System 页面（TODO）
        </text>
      );
  }
}

export function MainLayout({ tuiState, uiState, onSwitchPage, onCloseDetail }: MainLayoutProps) {
  const { currentPage } = uiState;

  return (
    <box style={{ flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <Header currentPage={currentPage} />

      {/* 主内容区：flex 1 占据剩余空间 */}
      <box style={{ flex: 1, padding: 1 }}>
        {renderPageContent(currentPage, tuiState, uiState, onCloseDetail)}
      </box>

      {/* Footer */}
      <Footer currentPage={currentPage} />
    </box>
  );
}
