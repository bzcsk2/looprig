/**
 * Supervisor 详情页
 *
 * 展示内容（按方案 5.2）：
 * - 候选 model target 和 provider
 * - 当前审查的 Worker、失败签名
 * - SupervisorAdvice 结构化字段
 * - Worker 采纳情况与净进展
 *
 * 中文注释：状态颜色使用 colors.status 映射
 */

import { DetailView } from "../common/DetailView.js";
import { colors } from "../../theme/colors.js";
import type { SupervisorSnapshot } from "../../store/types.js";

export interface SupervisorDetailViewProps {
  supervisor: SupervisorSnapshot;
  onClose: () => void;
}

/** 状态图标 */
const statusIndicator = (status: SupervisorSnapshot["status"]): string => {
  switch (status) {
    case "reviewing": return "*";
    case "cooldown": return "~";
    case "unavailable": return "x";
    case "idle": return "o";
    default: return "-";
  }
};

export function SupervisorDetailView({ supervisor, onClose }: SupervisorDetailViewProps) {
  const statusColor = colors.status[supervisor.status] ?? colors.fg.primary;
  const indicator = statusIndicator(supervisor.status);

  return (
    <DetailView
      title={`${indicator} Supervisor - ${supervisor.modelTarget}`}
      onClose={onClose}
      footer={
        <text color={colors.fg.muted}>按 Esc 或 q 返回</text>
      }
    >
      {/* 状态行 */}
      <text color={statusColor}>
        {indicator} {supervisor.status}
      </text>

      <text color={colors.border.normal}>---</text>

      <text color={colors.fg.muted}>ID: <text color={colors.fg.secondary}>{supervisor.id}</text></text>

      {supervisor.reviewingWorkerId && (
        <text color={colors.fg.muted}>
          审查 Worker: <text color={colors.accent.primary}>{supervisor.reviewingWorkerId}</text>
        </text>
      )}

      {supervisor.cooldownRemainingMs != null && supervisor.cooldownRemainingMs > 0 && (
        <text color={colors.status.warning}>
          冷却剩余: {Math.ceil(supervisor.cooldownRemainingMs / 1000)}s
        </text>
      )}

      {/* 占位：Advice 详情等待接入 */}
      <text color={colors.fg.dim}>
        (Advice 详情等待 TUI-OT-60 接入)
      </text>
    </DetailView>
  );
}
