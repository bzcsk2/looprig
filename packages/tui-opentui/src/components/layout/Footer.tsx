/**
 * Footer 组件
 *
 * 设计原则：
 * - 动态显示当前页面可用的快捷键
 * - 显示系统状态（provider、context、plugin、memory、mcp）
 * - 简洁单行，与 Header 呼应
 * - 中文注释：快捷键提示根据当前页面变化
 */

import { colors } from "../../theme/colors.js";
import type { PageId } from "../../store/ui-store.js";

export interface FooterProps {
  currentPage: PageId;
}

/** 获取当前页面的快捷键提示 */
const getShortcutsForPage = (page: PageId): string => {
  switch (page) {
    case "chat":
      return "Enter:发送 Esc:取消";
    case "orchestration":
      return "Tab:切换面板 Enter:详情";
    case "workers":
    case "supervisor":
    case "loop":
      return "Enter:详情 q:返回";
    case "system":
      return "r:刷新";
    default:
      return "Ctrl+C:退出";
  }
};

export function Footer({ currentPage }: FooterProps) {
  const shortcuts = getShortcutsForPage(currentPage);

  return (
    <box style={{ padding: 1, backgroundColor: colors.bg.secondary }}>
      <text color={colors.fg.muted}>
        {shortcuts}
      </text>
      <text color={colors.fg.dim}> | </text>
      <text color={colors.fg.dim}>
        Ctrl+C:退出
      </text>
    </box>
  );
}
