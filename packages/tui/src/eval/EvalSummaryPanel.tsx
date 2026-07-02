import React from 'react';
import { Box, Text } from '@covalo/ink';
import type { EvalRunReport } from '@covalo/core';
import { ModalShell } from '../ModalShell.js';
import { FG, TONE } from '../reasonix/tokens.js';

interface Props {
  report: EvalRunReport;
  onClose: () => void;
}

export function EvalSummaryPanel({ report, onClose }: Props): React.ReactElement {
  const { suiteSummary, overallScore, meta } = report;
  const officialLabel = meta.officialScore ? 'OFFICIAL' : 'DIAGNOSTIC';
  const officialColor = meta.officialScore ? TONE.ok : TONE.warn;

  return (
    <ModalShell title="Eval Complete" subtitle={`${meta.environmentId}/${meta.providerId} · ${officialLabel}`} onCancel={onClose}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Results</Text>
          <Text>  Environment: {meta.environmentId} / Provider: {meta.providerId}</Text>
          <Text>  Score type: <Text color={officialColor}>{officialLabel}</Text></Text>
          {meta.fallbackReason && <Text dimColor>  Note: {meta.fallbackReason}</Text>}
          <Text>  Total: {suiteSummary.totalCases}</Text>
          <Text>  Passed: <Text color={TONE.ok}>{suiteSummary.passed}</Text></Text>
          <Text>  Failed: <Text color={TONE.err}>{suiteSummary.failed}</Text></Text>
          {suiteSummary.errored > 0 && <Text>  Errors: <Text color={TONE.err}>{suiteSummary.errored}</Text></Text>}
          {suiteSummary.skipped > 0 && <Text>  Skipped: {suiteSummary.skipped}</Text>}
          <Text>
            {'  '}Overall Score:{' '}
            <Text bold color={overallScore >= 80 ? TONE.ok : overallScore >= 50 ? TONE.warn : TONE.err}>
              {overallScore.toFixed(2)}
            </Text>
          </Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Per-Case Breakdown</Text>
          {suiteSummary.results.map((r) => (
            <Box key={r.caseId} flexDirection="row">
              <Text>
                {'  '}{r.caseId}:{' '}
                <Text color={r.verdict === 'pass' ? TONE.ok : TONE.err} bold>
                  {r.verdict}
                </Text>
                <Text color={FG.faint}>
                  {' '}score={r.score?.finalScore.toFixed(1) ?? 'N/A'}
                </Text>
              </Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            Report saved at: .covalo/evals/{meta.runId}/
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Press ESC to close summary</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
