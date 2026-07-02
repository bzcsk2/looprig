import React, { useState } from 'react';
import { Box, Text, useInput } from '@covalo/ink';
import type { EvalCategory } from '@covalo/core';
import { ModalShell } from '../ModalShell.js';
import { FG, TONE } from '../reasonix/tokens.js';

interface Props {
  categories: EvalCategory[];
  onSelect: (category: EvalCategory) => void;
  onCancel: () => void;
}

export function EvalCategorySelect({ categories, onSelect, onCancel }: Props): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      onCancel();
      return;
    }
    if (categories.length === 0) return;
    if (key.upArrow) {
      setSelectedIdx(prev => (prev - 1 + categories.length) % categories.length);
    }
    if (key.downArrow) {
      setSelectedIdx(prev => (prev + 1) % categories.length);
    }
    if (key.return) {
      onSelect(categories[selectedIdx]);
    }
  });

  return (
    <ModalShell title="Select Evaluation Category" subtitle="Choose a category to evaluate" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        {categories.map((cat, i) => {
          const envGroups = new Map<string, number>();
          for (const su of cat.suites) {
            const prev = envGroups.get(su.environmentId) ?? 0;
            envGroups.set(su.environmentId, prev + su.cases.length);
          }
          const ENV_LABELS: Record<string, string> = {
            'sandbox.benchmark': 'benchmark',
            'sandbox.local': 'local',
            diagnostic: 'diagnostic',
          };
          const envBreakdown = Array.from(envGroups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([env, count]) => `${ENV_LABELS[env] ?? env}: ${count}`)
            .join(' · ');
          return (
            <Box key={cat.id} flexDirection="row">
              <Text color={i === selectedIdx ? TONE.brand : FG.faint}>
                {i === selectedIdx ? '❯ ' : '  '}
              </Text>
              <Text bold={i === selectedIdx} color={i === selectedIdx ? TONE.brand : FG.body}>
                {cat.title}
              </Text>
              <Text color={FG.faint}> — {cat.description}</Text>
              <Text color={FG.faint}> {envBreakdown}</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
