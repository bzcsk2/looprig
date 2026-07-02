import { Box, Text } from '@covalo/ink';
import { t } from './i18n/index.js';
import { FG, TONE } from './reasonix/tokens.js';

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
  reasoningActive?: boolean;
  tier?: string;
  cwd?: string;
  /** 编排循环当前轮次（保留自原 OrchestrationSummary 面板） */
  loopAttempt?: number;
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

export function StatusBar({ model, provider, agent, inputTokens, outputTokens, cacheHitTokens, cacheMissTokens, contextUsed, contextTotal, pendingInstructionCount, statusMessage, thinkingMode, reasoningActive, tier, cwd, loopAttempt }: StatusBarProps) {
  const rate = cacheRate(cacheHitTokens, cacheMissTokens);
  const agentShort = agent?.replace(/\s+(Agent|Mode)$/i, '') ?? agent;
  const cwdShort = cwd ? cwd.split('/').filter(Boolean).pop() ?? cwd : '';
  const thinkingLabel = thinkingMode ?? 'off';

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
      <Box width="100%" flexDirection="column">
        {/* top border separator */}
        <Box width="100%" height={1}>
          <Text color={FG.faint}>{'\u2500'.repeat(process.stdout.columns ?? 80)}</Text>
        </Box>
        {/* main info row */}
        <Box width="100%" flexDirection="row" paddingX={1} paddingY={0}>
          <Text bold color={TONE.brand}>{agentShort}</Text>
          <Text color={FG.meta}>{` \u00b7 ${provider}/${model}`}</Text>
          <Text color={TONE.accent}>{` \u00b7 [${thinkingLabel}]`}</Text>
          <Box flexGrow={1} />
          {loopAttempt !== undefined && (
            <Text bold color={TONE.brand}>{`Loop #${loopAttempt} `}</Text>
          )}
          <Text color={FG.faint}>{`${fmt(inputTokens)}i `}</Text>
          <Text color={FG.faint}>{`${rate}c `}</Text>
          <Text color={FG.sub}>{`${fmt(outputTokens)}o `}</Text>
          <Text color={FG.meta}>{`${fmt(contextUsed)}/${fmt(contextTotal)}`}</Text>
        </Box>
      </Box>
    </Box>
  );
}
