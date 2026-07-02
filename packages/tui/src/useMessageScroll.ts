import { useInput, type InputEvent } from '@covalo/ink';
import type { ScrollBoxHandle } from '@covalo/ink';
import type React from 'react';

type MessageScrollKey = {
  wheelUp?: boolean;
  wheelDown?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  ctrl?: boolean;
  home?: boolean;
  end?: boolean;
};

/**
 * Apply one message-scroll key. Manual upward movement breaks ScrollBox
 * stickiness, so streaming output cannot pull the viewport back to the bottom.
 * Reaching the bottom or pressing End restores sticky auto-follow.
 */
export function applyMessageScrollKey(
  scroll: ScrollBoxHandle,
  key: MessageScrollKey,
): boolean {
  const viewport = Math.max(1, scroll.getViewportHeight?.() ?? 12);
  const page = Math.max(1, Math.round(viewport * 0.85));

  if (key.wheelUp) {
    scroll.scrollBy(-3);
    return true;
  }
  if (key.wheelDown) {
    const scrollTop = scroll.getScrollTop?.() ?? 0;
    const pending = scroll.getPendingDelta?.() ?? 0;
    const maxScroll = Math.max(0, (scroll.getScrollHeight?.() ?? 0) - viewport);
    if (scrollTop + pending + 3 >= maxScroll) {
      scroll.scrollToBottom();
    } else {
      scroll.scrollBy(3);
    }
    return true;
  }
  if (key.pageUp || (key.ctrl && key.upArrow)) {
    scroll.scrollBy(-page);
    return true;
  }
  if (key.pageDown || (key.ctrl && key.downArrow)) {
    const scrollTop = scroll.getScrollTop?.() ?? 0;
    const pending = scroll.getPendingDelta?.() ?? 0;
    const maxScroll = Math.max(0, (scroll.getScrollHeight?.() ?? 0) - viewport);
    if (scrollTop + pending + page >= maxScroll) {
      scroll.scrollToBottom();
    } else {
      scroll.scrollBy(page);
    }
    return true;
  }
  if (key.home) {
    scroll.scrollTo(0);
    return true;
  }
  if (key.end) {
    scroll.scrollToBottom();
    return true;
  }
  return false;
}

/**
 * 绑定消息区 ScrollBox 的滚轮和键盘滚动。
 * 消费滚动事件，避免输入框把终端滚轮误当作历史命令方向键。
 */
export function useMessageScroll(
  scrollRef: React.RefObject<ScrollBoxHandle | null>,
  isActive: boolean,
): void {
  useInput((_input, key, event: InputEvent) => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    if (applyMessageScrollKey(scroll, key)) {
      event.stopImmediatePropagation();
    }
  }, { isActive });
}

/** Restore bottom-follow after an overlay temporarily unmounts the message ScrollBox. */
export function restoreMessageScrollAfterOverlay(
  scrollRef: React.RefObject<ScrollBoxHandle | null>,
): void {
  queueMicrotask(() => scrollRef.current?.scrollToBottom());
}
