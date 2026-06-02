import { Box, Text } from '@deepicode/ink';
import { t } from './i18n/index.js';

interface StatusBarProps {
  model: string;
  provider: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  contextUsed: number;
  contextTotal: number;
  pendingInstructionCount?: number;
  statusMessage?: string | null;
  thinkingMode?: string;
  tier?: string;
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

export function StatusBar({ model, provider, agent, inputTokens, outputTokens, cacheHitTokens, cacheMissTokens, contextUsed, contextTotal, pendingInstructionCount, statusMessage, thinkingMode, tier }: StatusBarProps) {
  const rate = cacheRate(cacheHitTokens, cacheMissTokens);
  return (
    <Box width="100%" flexDirection="column">
      {statusMessage && (
        <Box>
          <Text inverse color="warning">{` \u26a0 ${statusMessage} `}</Text>
        </Box>
      )}
      {pendingInstructionCount ? (
        <Box>
          <Text inverse color="success">{` \u{1F4E5} ${t().pendingTasks}${pendingInstructionCount} `}</Text>
        </Box>
      ) : null}
      {thinkingMode && thinkingMode !== 'off' ? (
        <Box>
          <Text inverse color="success">{` \u{1F9E0} Thinking: ${thinkingMode} `}</Text>
        </Box>
      ) : null}
      <Box width="100%" flexDirection="row">
        <Text inverse>{` ${provider}`}</Text>
        <Text inverse>{` ${model} `}</Text>
        <Text inverse>{` [${agent}] `}</Text>
        {tier ? <Text inverse>{` [${tier}] `}</Text> : null}
        <Box flexGrow={1} />
        <Text inverse>{` ${t().inputTokens}${fmt(inputTokens)}`}</Text>
        <Text inverse>{` ${t().cacheHit}${rate}`}</Text>
        <Text inverse>{` ${t().outputTokens}${fmt(outputTokens)} `}</Text>
        <Text inverse>{` ${fmt(contextUsed)}/${fmt(contextTotal)} `}</Text>
      </Box>
    </Box>
  );
}
