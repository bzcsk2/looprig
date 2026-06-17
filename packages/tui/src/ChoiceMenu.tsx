import { useState, type ReactElement } from 'react';
import { Box, Text, useInput } from '@deepreef/ink';
import { ModalShell } from './ModalShell.js';
import { FG, TONE } from './reasonix/tokens.js';

export interface ChoiceItem {
  value: string;
  label: string;
  description?: string;
}

interface ChoiceMenuProps {
  title: string;
  subtitle?: string;
  items: ChoiceItem[];
  onChoose: (value: string) => void;
  onCancel: () => void;
  footer?: string;
}

function getItems(title: string, items: ChoiceItem[]): ChoiceItem[] {
  if (title !== 'Thinking') return items;
  return [
    { value: 'off', label: 'off', description: 'no extra thinking budget' },
    { value: 'high', label: 'high', description: 'strong thinking budget' },
    { value: 'max', label: 'max', description: 'maximum thinking budget' },
  ];
}

export function ChoiceMenu({ title, subtitle, items, onChoose, onCancel, footer }: ChoiceMenuProps): ReactElement {
  const visibleItems = getItems(title, items);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      onCancel();
      return;
    }

    if (visibleItems.length === 0) return;

    if (key.upArrow) {
      setSelectedIdx(prev => (prev - 1 + visibleItems.length) % visibleItems.length);
      return;
    }

    if (key.downArrow) {
      setSelectedIdx(prev => (prev + 1) % visibleItems.length);
      return;
    }

    if (key.return) {
      const item = visibleItems[selectedIdx];
      if (item) onChoose(item.value);
    }
  });

  return (
    <ModalShell title={title} subtitle={subtitle} onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        {visibleItems.map((item, i) => (
          <Box key={item.value} flexDirection="row">
            <Text color={i === selectedIdx ? TONE.brand : FG.faint}>{i === selectedIdx ? '* ' : '  '}</Text>
            <Text bold={i === selectedIdx} color={i === selectedIdx ? TONE.brand : FG.body}>
              {item.label}
            </Text>
            {item.description ? <Text color={FG.faint}> {item.description}</Text> : null}
          </Box>
        ))}

        <Box marginTop={1}>
          <Text dimColor>{footer ?? 'Up/Down select · Enter confirm · Esc close'}</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
