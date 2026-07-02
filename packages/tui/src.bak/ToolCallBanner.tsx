import React from 'react';
import { Box, Text } from '@covalo/ink';
import type { ToolStatus } from './bridge.js';

interface ToolCallBannerProps {
  activeTools: Map<string, ToolStatus>;
}

export function ToolCallBanner({ activeTools }: ToolCallBannerProps) {
  if (activeTools.size === 0) return null;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {Array.from(activeTools.entries()).map(([key, tool]) => {
        const icon = tool.status === 'running' ? '⏺' : tool.status === 'done' ? '✓' : '✗';
        const color = tool.status === 'running' ? 'warning' : tool.status === 'done' ? 'success' : 'error' as const;
        return (
          <Box key={key}>
            <Text color={color}>{icon}</Text>
            <Text> [{tool.name}]</Text>
            {tool.status === 'done' && tool.output && (
              <Text dimColor> → {tool.output.slice(0, 80)}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
