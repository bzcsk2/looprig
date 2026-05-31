import { Box, Text } from '@deepicode/ink';
import React from 'react';
import { FG } from './tokens.js';

export type MetaItem = string | { text: string; color: string };

export interface CardHeaderProps {
  glyph: string;
  tone: string;
  title: string;
  subtitle?: string;
  meta?: ReadonlyArray<MetaItem>;
  right?: React.ReactNode;
}

export function CardHeader({ glyph, tone, title, subtitle, meta, right }: CardHeaderProps): React.ReactElement {
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={tone as any}>{glyph}</Text>
      <Text bold color={tone as any}>{title}</Text>
      {subtitle ? <Text color={FG.body}>{subtitle}</Text> : null}
      {meta?.map((item, i) => {
        const isStr = typeof item === 'string';
        const text = isStr ? item : item.text;
        const color = isStr ? FG.faint : item.color;
        return (
          <React.Fragment key={`m-${i}`}>
            <Text color={FG.faint}>{'\u00B7'}</Text>
            <Text color={color}>{text}</Text>
          </React.Fragment>
        );
      })}
      {right}
    </Box>
  );
}
