import { useInput } from '@deepreef/ink';
import type { ScrollBoxHandle } from '@deepreef/ink';
import type React from 'react';

/**
 * 绑定消息区 ScrollBox 的键盘滚动 — 仅保留 Home/End。
 * PageUp/PageDown、Ctrl+方向键、鼠标滚轮均已禁用。
 */
export function useMessageScroll(
  scrollRef: React.RefObject<ScrollBoxHandle | null>,
  isActive: boolean,
): void {
  useInput((_input, key) => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    if (key.home) {
      scroll.scrollTo(0);
      return;
    }
    if (key.end) {
      scroll.scrollToBottom();
    }
  }, { isActive });
}
