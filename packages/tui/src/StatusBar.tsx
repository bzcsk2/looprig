import { Box, Text } from '@deepicode/ink';
import { t } from './i18n/index.js';
import { FG, SURFACE, TONE } from './reasonix/tokens.js';

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
  cwd?: string;
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

export function StatusBar({ model, provider, agent, inputTokens, outputTokens, cacheHitTokens, cacheMissTokens, contextUsed, contextTotal, pendingInstructionCount, statusMessage, thinkingMode, tier, cwd }: StatusBarProps) {
  const rate = cacheRate(cacheHitTokens, cacheMissTokens);
  return (
    <Box width="100%" flexDirection="column">
      {statusMessage && (
        <Box>
          <Text color={TONE.warn}>{` \u26a0 ${statusMessage} `}</Text>
        </Box>
      )}
      {pendingInstructionCount ? (
        <Box>
          <Text color={TONE.ok}>{` \u{1F4E5} ${t().pendingTasks}${pendingInstructionCount} `}</Text>
        </Box>
      ) : null}
      {thinkingMode && thinkingMode !== 'off' ? (
        <Box>
          <Text color={TONE.accent}>{` \u{1F9E0} Thinking: ${thinkingMode} `}</Text>
        </Box>
      ) : null}
      <Box width="100%" flexDirection="row" backgroundColor={SURFACE.bgCode} paddingX={1}>
        <Text color={FG.meta}>{`${provider} ${model}`}</Text>
        <Text color={TONE.accent}>{` [${agent}]`}</Text>
        {tier ? <Text color={FG.sub}>{` [${tier}]`}</Text> : null}
        <Box flexGrow={1} />
        <Text color={FG.faint}>{`${t().inputTokens}${fmt(inputTokens)} `}</Text>
        <Text color={FG.faint}>{`${t().cacheHit}${rate} `}</Text>
        <Text color={FG.faint}>{`${t().outputTokens}${fmt(outputTokens)} `}</Text>
        <Text color={FG.sub}>{`${fmt(contextUsed)}/${fmt(contextTotal)}`}</Text>
        {cwd ? <Text color={TONE.ok}>{`  ${cwd}`}</Text> : null}
      </Box>
    </Box>
  );
}
