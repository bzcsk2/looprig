import React from 'react';
import { Box, Text } from '@covalo/ink';
import type { EvalCategoryId, EvalSuiteId, EvalProgressEvent, EvalEnvironmentId } from '@covalo/core';
import { resolveEvalEnvironment } from '@covalo/core/sandbox/types.js';
import { ModalShell } from '../ModalShell.js';
import { FG, TONE } from '../reasonix/tokens.js';
import { Spinner } from '../Spinner.js';

interface Props {
  categoryId: EvalCategoryId;
  suiteId: EvalSuiteId;
  environmentId?: EvalEnvironmentId;
  latestEvent: EvalProgressEvent | null;
  onCancel: () => void;
}

export function EvalRunPanel({ categoryId, suiteId, environmentId, latestEvent, onCancel }: Props): React.ReactElement {
  const progressText = latestEvent
    ? `[${latestEvent.completedCases ?? 0}/${latestEvent.totalCases ?? '?'}]`
    : '[0/?]';

  return (
    <ModalShell
      title={`Running Eval — ${categoryId}/${suiteId}`}
      subtitle={`env=${resolveEvalEnvironment(environmentId ?? '')} ${progressText}`}
      onCancel={onCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row">
          <Spinner loading />
          <Text> Eval in progress... (ESC to cancel)</Text>
        </Box>

        {latestEvent && latestEvent.type === 'case-start' && (
          <Box marginTop={1}>
            <Text color={TONE.brand}>
              Running: {latestEvent.caseId} — {latestEvent.title}
            </Text>
          </Box>
        )}

        {latestEvent && latestEvent.type === 'case-end' && latestEvent.result && (
          <Box marginTop={1}>
            <Text>
              {latestEvent.result.caseId}:{' '}
              <Text
                color={latestEvent.result.verdict === 'pass' ? TONE.ok : latestEvent.result.verdict === 'infra_error' ? TONE.warn : TONE.err}
                bold
              >
                {latestEvent.result.verdict === 'infra_error' ? 'INFRA_ERROR' : latestEvent.result.verdict.toUpperCase()}
              </Text>
              <Text color={FG.faint}>
                {' '}score: {latestEvent.result.score?.finalScore.toFixed(1) ?? 'N/A'}
              </Text>
            </Text>
          </Box>
        )}

        {latestEvent && latestEvent.type === 'infra-error' && (
          <Box marginTop={1}>
            <Text color={TONE.warn}>
              ⚠ INFRASTRUCTURE ERROR: {latestEvent.error ?? 'Environment check failed'}
            </Text>
          </Box>
        )}

        {latestEvent && latestEvent.type === 'preflight' && latestEvent.preflight && (
          <Box marginTop={1} flexDirection="column">
            <Text color={TONE.warn}>
              Preflight checks: {latestEvent.preflight.allFound ? 'All tools found' : 'Some tools missing'}
            </Text>
            {!latestEvent.preflight.allFound && (
              <Box flexDirection="column" marginLeft={2}>
                {latestEvent.preflight.checks.filter(c => !c.found).map(c => (
                  <Text key={c.name} color={TONE.err}>
                    ✗ {c.name} not found
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}

        {latestEvent && latestEvent.type === 'error' && (
          <Box marginTop={1}>
            <Text color={TONE.err}>Error: {latestEvent.error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>ESC to cancel current run</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
