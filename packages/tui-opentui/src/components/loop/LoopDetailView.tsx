/**
 * Loop 详情页
 *
 * 展示内容（按方案 5.3）：
 * - 当前 phase 和 attempt
 * - 最近 phase 转换历史
 * - runtime signal
 * - checkpoint 状态
 *
 * 中文注释：phase 颜色使用 colors.status.info 强调
 */

import { DetailView } from "../common/DetailView.js";
import { colors } from "../../theme/colors.js";
import type { TuiState } from "../../store/types.js";

export interface LoopDetailViewProps {
  loopState: TuiState["loop"];
  onClose: () => void;
}

export function LoopDetailView({ loopState, onClose }: LoopDetailViewProps) {
  return (
    <DetailView
      title={`Loop State - ${loopState.phase}`}
      onClose={onClose}
      footer={
        <text color={colors.fg.muted}>按 Esc 或 q 返回</text>
      }
    >
      {/* 当前 Phase 高亮显示 */}
      <text color={colors.status.info}>
        当前 Phase: {loopState.phase}
      </text>

      <text color={colors.fg.muted}>
        Attempt: <text color={colors.fg.primary}>{loopState.attempt}</text>
      </text>

      {loopState.lastTransition && (
        <>
          <text color={colors.border.normal}>---</text>
          <text color={colors.fg.muted}>
            上次转换: {loopState.lastTransition.from} -
            <text color={colors.status.info}> {loopState.lastTransition.to}</text>
          </text>
        </>
      )}

      {/* 占位：TaskLedger、checkpoint、signal 等待接入 */}
      <text color={colors.fg.dim}>
        (TaskLedger、checkpoint、signal 等待 TUI-OT-60 接入)
      </text>
    </DetailView>
  );
}
