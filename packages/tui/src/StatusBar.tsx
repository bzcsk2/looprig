import React from 'react';
import { Box, Text } from '@deepicode/ink';

interface StatusBarProps {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
}

export function StatusBar({ model, provider, inputTokens, outputTokens }: StatusBarProps) {
  return (
    <Box width="100%" flexDirection="row">
      <Text inverse>{` ${provider}`}</Text>
      <Text inverse>{` ${model} `}</Text>
      <Box flexGrow={1} />
      <Text inverse>{` ↑${inputTokens}`}</Text>
      <Text inverse>{` ↓${outputTokens} `}</Text>
    </Box>
  );
}
