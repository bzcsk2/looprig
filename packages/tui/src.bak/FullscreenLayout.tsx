import React, { type ReactNode } from 'react';
import { Box, ScrollBox, type ScrollBoxHandle } from '@covalo/ink';
import { isFullscreenEnvEnabled } from './fullscreen.js';

type Props = {
  scrollable: ReactNode;
  bottom: ReactNode;
  scrollRef?: React.RefObject<ScrollBoxHandle | null>;
};

export function FullscreenLayout({ scrollable, bottom, scrollRef }: Props): React.ReactNode {
  if (isFullscreenEnvEnabled()) {
    return (
      <Box flexDirection="row" flexGrow={1} overflow="hidden" width="100%">
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
    <Box flexDirection="column" flexGrow={1} overflow="hidden" width="100%">
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
