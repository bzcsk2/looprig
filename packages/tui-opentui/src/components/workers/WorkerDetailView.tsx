/**
 * Worker 详情页
 *
 * 设计原则（参考 Ralph WorkerDetailView）：
 * - 标题栏显示 Worker 编号、状态图标、耗时
 * - 任务信息清晰展示
 * - 简洁布局，便于后续扩展 TaskLedger、工具历史
 *
 * 中文注释说明：
 * - 状态颜色使用 colors.task 映射，与 Dashboard 保持一致
 * - 后续手动调整布局时，修改 flex 和 padding 即可
 */

import { DetailView } from "../common/DetailView.js";
import { colors } from "../../theme/colors.js";
import type { WorkerSnapshot } from "../../store/types.js";

export interface WorkerDetailViewProps {
  worker: WorkerSnapshot;
  workerIndex?: number;
  onClose: () => void;
}

/** 状态图标（与 Dashboard 保持一致） */
const statusIndicator = (status: WorkerSnapshot["status"]): string => {
  switch (status) {
    case "running": return ">";
    case "completed": return "v";
    case "failed": return "x";
    case "waiting_permission": return "!";
    case "waiting_question": return "?";
    case "paused": return "||";
    default: return "o";
  }
};

/** 格式化耗时显示（秒或分钟） */
const formatElapsed = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

export function WorkerDetailView({ worker, workerIndex = 0, onClose }: WorkerDetailViewProps) {
  const statusColor = colors.task[worker.status] ?? colors.fg.primary;
  const indicator = statusIndicator(worker.status);
  const elapsed = formatElapsed(worker.elapsedMs);

  return (
    <DetailView
      title={`${indicator} Worker W${workerIndex + 1} - ${worker.modelTarget}`}
      onClose={onClose}
      footer={
        <text color={colors.fg.muted}>按 Esc 或 q 返回 | p 暂停 | c 取消</text>
      }
    >
      {/* 状态行：图标 + 状态名 + 耗时 */}
      <text color={statusColor}>
        {indicator} {worker.status} <text color={colors.fg.dim}>{elapsed}</text>
      </text>

      {/* 分隔线 */}
      <text color={colors.border.normal}>---</text>

      {/* 任务信息 */}
      <text color={colors.fg.muted}>ID: <text color={colors.fg.secondary}>{worker.id}</text></text>
      
      {worker.currentTask && (
        <text color={colors.fg.muted}>
          任务: <text color={colors.fg.primary}>{worker.currentTask}</text>
        </text>
      )}

      {worker.parentAgentId && (
        <text color={colors.fg.muted}>
          父 Agent: <text color={colors.accent.secondary}>{worker.parentAgentId}</text>
        </text>
      )}

      {/* 占位：后续接入 TaskLedger、工具历史、验证结果 */}
      <text color={colors.fg.dim}>
        (TaskLedger、工具历史等待 TUI-OT-60 接入)
      </text>
    </DetailView>
  );
}
