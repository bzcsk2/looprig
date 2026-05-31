import React, { useState, useEffect } from 'react';
import { Box, Text } from '@deepicode/ink';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

interface SpinnerProps {
  loading: boolean;
  message?: string;
}

export function Spinner({ loading, message }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!loading) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loading]);

  if (!loading) return null;

  return (
    <Box paddingX={1}>
      <Text color="success">{FRAMES[frame]}</Text>
      {message && <Text> {message}</Text>}
    </Box>
  );
}
