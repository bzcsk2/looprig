import React, { type ReactNode } from 'react';
import { Box, ScrollBox, Text, type ScrollBoxHandle } from '@deepreef/ink';
import { isFullscreenEnvEnabled } from './fullscreen.js';
import { FG } from './reasonix/tokens.js';

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
          {/* top border accent */}
          <Box height={1}>
            <Text color={FG.faint}>{'\u2500'.repeat(process.stdout.columns ?? 80)}</Text>
          </Box>
          <Box flexGrow={1} flexDirection="column" overflow="hidden">
            <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" paddingTop={1}>
              {scrollable}
            </ScrollBox>
          </Box>
          {/* separator before bottom */}
          <Box height={1}>
            <Text color={FG.faint}>{'\u2500'.repeat(process.stdout.columns ?? 80)}</Text>
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
      {/* top border accent */}
      <Box height={1}>
        <Text color={FG.faint}>{'\u2500'.repeat(process.stdout.columns ?? 80)}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" paddingTop={1}>
          {scrollable}
        </ScrollBox>
      </Box>
      {/* separator before bottom */}
      <Box height={1}>
        <Text color={FG.faint}>{'\u2500'.repeat(process.stdout.columns ?? 80)}</Text>
      </Box>
      <Box flexDirection="column" flexShrink={0} width="100%">
        <Box flexDirection="column" width="100%" flexGrow={1}>
          {bottom}
        </Box>
      </Box>
    </Box>
  );
}
