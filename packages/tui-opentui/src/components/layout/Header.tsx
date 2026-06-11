/**
 * Header 组件
 *
 * 设计原则（参考 Ralph）：
 * - 显示 Deepreef 品牌、当前页面、会话信息
 * - 简洁单行，不占用过多空间
 * - 中文注释：颜色使用 accent.primary 强调品牌
 */

import { colors } from "../../theme/colors.js";
import type { PageId, UiState } from "../../store/ui-store.js";
import { pageNames } from "../../store/ui-store.js";

export interface HeaderProps {
  currentPage: PageId;
}

export function Header({ currentPage }: HeaderProps) {
  return (
    <box style={{ padding: 1, backgroundColor: colors.bg.secondary }}>
      <text bold color={colors.accent.primary}>
        Deepreef
      </text>
      <text color={colors.fg.dim}> | </text>
      <text bold color={colors.fg.primary}>
        {pageNames[currentPage]}
      </text>
      <text color={colors.fg.dim}> | </text>
      <text color={colors.fg.muted}>
        1:Chat 2:Overview 3:Workers 4:Supervisor 5:Loop 6:System
      </text>
    </box>
  );
}
