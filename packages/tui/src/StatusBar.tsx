import { Box, Text } from '@deepicode/ink';

interface StatusBarProps {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  contextUsed: number;
  contextTotal: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function cacheRate(hit: number, miss: number): string {
  const total = hit + miss;
  if (total === 0) return '--';
  return `${Math.round((hit / total) * 100)}%`;
}

export function StatusBar({ model, provider, inputTokens, outputTokens, cacheHitTokens, cacheMissTokens, contextUsed, contextTotal }: StatusBarProps) {
  const rate = cacheRate(cacheHitTokens, cacheMissTokens);
  return (
    <Box width="100%" flexDirection="row">
      <Text inverse>{` ${provider}`}</Text>
      <Text inverse>{` ${model} `}</Text>
      <Box flexGrow={1} />
      <Text inverse>{` in${fmt(inputTokens)}`}</Text>
      <Text inverse>{` hit${rate}`}</Text>
      <Text inverse>{` out${fmt(outputTokens)} `}</Text>
      <Text inverse>{` ${fmt(contextUsed)}/${fmt(contextTotal)} `}</Text>
    </Box>
  );
}
