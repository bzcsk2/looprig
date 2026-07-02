import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from '@covalo/ink';
import type { EvalCategory, EvalSuite, EvalEnvironmentId, EvalCategoryId } from '@covalo/core';
import { getFilteredSuites } from '@covalo/core/eval/registry.js';
import { ModalShell } from '../ModalShell.js';
import { FG, TONE } from '../reasonix/tokens.js';

interface Props {
  category: EvalCategory;
  environmentId: EvalEnvironmentId;
  onSelect: (suite: EvalSuite) => void;
  onCancel: () => void;
}

export function EvalSuiteSelect({ category, environmentId, onSelect, onCancel }: Props): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const suites = useMemo(() => getFilteredSuites(category.id as EvalCategoryId, environmentId), [category.id, environmentId]);

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      onCancel();
      return;
    }
    if (suites.length === 0) return;
    if (key.upArrow) {
      setSelectedIdx(prev => (prev - 1 + suites.length) % suites.length);
    }
    if (key.downArrow) {
      setSelectedIdx(prev => (prev + 1) % suites.length);
    }
    if (key.return) {
      onSelect(suites[selectedIdx]);
    }
  });

  return (
    <ModalShell
      title={`Test Sets — ${category.title}`}
      subtitle={category.description}
      onCancel={onCancel}
    >
      <Box flexDirection="column" gap={1}>
        {suites.map((suite: EvalSuite, i: number) => (
          <Box key={suite.id} flexDirection="row">
            <Text color={i === selectedIdx ? TONE.brand : FG.faint}>
              {i === selectedIdx ? '❯ ' : '  '}
            </Text>
            <Text bold={i === selectedIdx} color={i === selectedIdx ? TONE.brand : FG.body}>
              {suite.title}
            </Text>
            <Text color={FG.faint}> — {suite.description}</Text>
            <Text color={FG.faint}>
              {' '}({suite.cases.length} cases, ~{suite.estimatedMinutes})
            </Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>↑↓ select · Enter confirm · Esc back</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
