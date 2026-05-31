import { Box, Text, useAnimationFrame } from '@deepicode/ink';
import React from 'react';

const FRAMES = {
  circle: ['\u25D0', '\u25D3', '\u25D1', '\u25D2'] as const,
  braille: ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827'] as const,
};

export interface SpinnerProps { kind?: keyof typeof FRAMES; color?: string; bold?: boolean; }

export function Spinner({ kind = 'circle', color, bold }: SpinnerProps): React.ReactElement {
  const frames = FRAMES[kind];
  const [ref, time] = useAnimationFrame(120);
  const frame = Math.floor(time / 120) % frames.length;
  return <Box ref={ref}><Text bold={bold} color={color as any}>{frames[frame]}</Text></Box>;
}
