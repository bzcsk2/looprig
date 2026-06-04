import React, { type ReactNode } from 'react';
import { Box, ScrollBox, type ScrollBoxHandle } from '@deepicode/ink';
import { isFullscreenEnvEnabled } from './fullscreen.js';
import { SURFACE } from './reasonix/tokens.js';

/**
 * FullscreenLayout —— 全屏布局容器
 *
 * 根据终端是否支持全屏，决定以横向（side-by-side）还是纵向（垂直堆叠）方式排布子区域。
 * 包含可滚动内容区和底部固定区域。
 * 所有 box-sizing、overflow、尺寸相关参数调整都会影响整体显示效果。
 */
type Props = {
  /** 主内容区——可滚动的内容，放在 ScrollBox 中渲染 */
  scrollable: ReactNode;
  /** 底部区域——固定在底部，不滚动，通常用于状态栏/提示/输入行等 */
  bottom: ReactNode;
  /** 可选的 ScrollBox 引用句柄，外部可通过它控制滚动位置 */
  scrollRef?: React.RefObject<ScrollBoxHandle | null>;
};

export function FullscreenLayout({ scrollable, bottom, scrollRef }: Props): React.ReactNode {
  if (isFullscreenEnvEnabled()) {
    return (
      <Box flexDirection="row" flexGrow={1} overflow="hidden" width="100%" backgroundColor={SURFACE.bg}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <Box flexGrow={1} flexDirection="column" overflow="hidden">
            <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" paddingTop={1} stickyScroll>
              {scrollable}
            </ScrollBox>
          </Box>
          <Box flexDirection="column" flexShrink={0} width="100%">
            <Box flexDirection="column" width="100%" flexGrow={1}>
              {bottom}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden" width="100%" backgroundColor={SURFACE.bg}>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" paddingTop={1} stickyScroll>
          {scrollable}
        </ScrollBox>
      </Box>
      <Box flexDirection="column" flexShrink={0} width="100%">
        <Box flexDirection="column" width="100%" flexGrow={1}>
          {bottom}
        </Box>
      </Box>
    </Box>
  );
}
