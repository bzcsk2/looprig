import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from '@deepreef/ink';
import type { EvalEnvironmentId } from '@deepreef/core';
import { ModalShell } from '../ModalShell.js';
import { TONE } from '../reasonix/tokens.js';

interface EnvironmentOption {
  id: EvalEnvironmentId;
  label: string;
  description: string;
}

const ENVIRONMENTS: EnvironmentOption[] = [
  { id: 'sandbox.benchmark', label: 'Sandbox.Benchmark', description: 'Official evaluation environment with managed toolchain and bwrap isolation (Linux)' },
  { id: 'sandbox.local', label: 'Sandbox.Local', description: 'Local diagnostic environment — uses host or fallback tools, not official score' },
];

interface Props {
  onSelect: (envId: EvalEnvironmentId) => void;
  onCancel: () => void;
}

export function EvalEnvironmentSelect({ onSelect, onCancel }: Props): React.ReactElement {
  const [selected, setSelected] = useState(0);

  useInput(
    useCallback(
      (input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }) => {
        if (key.escape) {
          onCancel();
          return;
        }
        if (key.return) {
          onSelect(ENVIRONMENTS[selected]!.id);
          return;
        }
        if (key.upArrow) {
          setSelected((prev) => (prev > 0 ? prev - 1 : ENVIRONMENTS.length - 1));
          return;
        }
        if (key.downArrow) {
          setSelected((prev) => (prev < ENVIRONMENTS.length - 1 ? prev + 1 : 0));
          return;
        }
      },
      [selected, onSelect, onCancel],
    ),
  );

  return (
    <ModalShell title="Select Environment" subtitle="Choose evaluation environment" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        {ENVIRONMENTS.map((env, i) => (
          <Box key={env.id} flexDirection="column">
            <Box flexDirection="row">
              <Text color={i === selected ? TONE.brand : undefined}>
                {i === selected ? '❯ ' : '  '}
              </Text>
              <Text bold={i === selected} color={i === selected ? TONE.brand : undefined}>
                {env.label}
              </Text>
              {env.id === 'sandbox.benchmark' && <Text color={TONE.ok}> (default)</Text>}
              {env.id === 'sandbox.local' && <Text color={TONE.warn}> (diagnostic)</Text>}
            </Box>
            <Box>
              <Text>  {env.description}</Text>
            </Box>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate · Enter select · ESC cancel</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
