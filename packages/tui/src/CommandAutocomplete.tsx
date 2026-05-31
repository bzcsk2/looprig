import { Box, Text, useInput } from '@deepicode/ink';
import React, { useState, useMemo } from 'react';
import { filterCommands, type SlashCommand } from './CommandRegistry.js';
import { TONE, FG } from './reasonix/tokens.js';

interface CommandAutocompleteProps {
  query: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function CommandAutocomplete({ query, onSelect, onClose }: CommandAutocompleteProps): React.ReactElement | null {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const matches = useMemo(() => filterCommands(query), [query]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIdx(prev => (prev - 1 + matches.length) % matches.length);
    } else if (key.downArrow) {
      setSelectedIdx(prev => (prev + 1) % matches.length);
    } else if (key.return) {
      const cmd = matches[selectedIdx];
      if (cmd) onSelect(cmd.name);
    } else if (key.tab) {
      const cmd = matches[selectedIdx];
      if (cmd) onSelect(cmd.name);
    } else if (key.escape) {
      onClose();
    }
  });

  if (matches.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={TONE.brand} paddingX={1} marginBottom={1}>
      {matches.map((cmd, i) => (
        <Box key={cmd.name} flexDirection="row">
          <Text color={i === selectedIdx ? TONE.brand : undefined}>
            {i === selectedIdx ? '> ' : '  '}
          </Text>
          <Text bold={i === selectedIdx} color={i === selectedIdx ? TONE.brand : undefined}>
            {cmd.name}
          </Text>
          <Text color={FG.faint}> {cmd.description}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ select · Enter/Tab complete · Esc close</Text>
      </Box>
    </Box>
  );
}
