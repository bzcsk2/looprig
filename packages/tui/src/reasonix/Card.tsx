import { Box } from '@deepicode/ink';
import React from 'react';

export interface CardProps { tone?: string; children: React.ReactNode; }

export function Card({ children }: CardProps): React.ReactElement {
  return <Box flexDirection="column" marginTop={1} width="100%">{children}</Box>;
}
