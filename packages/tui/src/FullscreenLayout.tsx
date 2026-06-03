import React, { type ReactNode } from 'react';
import { Box, ScrollBox, Text, type ScrollBoxHandle } from '@deepicode/ink';
import { isFullscreenEnvEnabled } from './fullscreen.js';
import { FG, SURFACE, TONE } from './reasonix/tokens.js';

type Props = {
  scrollable: ReactNode;
  bottom: ReactNode;
  scrollRef?: React.RefObject<ScrollBoxHandle | null>;
};

export function FullscreenLayout({ scrollable, bottom, scrollRef }: Props): React.ReactNode {
  if (isFullscreenEnvEnabled()) {
    return (
      <Box flexDirection="row" flexGrow={1} overflow="hidden" width="100%" backgroundColor={SURFACE.bg}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <TerminalHeader />
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
      <TerminalHeader />
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

export function TerminalHeader(): React.ReactElement {
  return (
    <Box width="100%" flexDirection="row" backgroundColor={SURFACE.bgCode} paddingX={1}>
      <Text color={TONE.err}>{'\u25CF '}</Text>
      <Text color={TONE.warn}>{'\u25CF '}</Text>
      <Text color={TONE.ok}>{'\u25CF'}</Text>
      <Box flexGrow={1} />
      <Text color={FG.meta}>deepicode agent terminal</Text>
      <Box flexGrow={1} />
    </Box>
  );
}
