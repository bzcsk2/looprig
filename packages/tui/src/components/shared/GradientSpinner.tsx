/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copied from gemini-cli/packages/cli/src/ui/components/GeminiSpinner.tsx
 * and adapted for Deepreef TUI.
 *
 * Changes from Gemini:
 * - Replaced CliSpinner with inline braille animation frames
 * - Uses themeManager.getColors() instead of static Colors import
 * - Removed useIsScreenReaderEnabled (not available in @covalo/ink)
 */

import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Text, type HexColor } from '@covalo/ink';
import tinygradient from 'tinygradient';
import { themeManager } from '../../theme/theme-manager.js';

const COLOR_CYCLE_DURATION_MS = 4000;
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface GradientSpinnerProps {
  altText?: string;
}

export const GradientSpinner: React.FC<GradientSpinnerProps> = ({
  altText: _altText,
}) => {
  const [time, setTime] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);

  const gradient = useMemo(() => {
    const colors = themeManager.getColors();
    const brandColors = [
      colors.AccentPurple,
      colors.AccentBlue,
      colors.AccentCyan,
      colors.AccentGreen,
      colors.AccentYellow,
      colors.AccentRed,
    ];
    return tinygradient([...brandColors, brandColors[0]]);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTime((prev) => prev + 30);
      setFrameIndex((prev) => (prev + 1) % FRAMES.length);
    }, 30); // ~33fps for smooth color transitions
    return () => clearInterval(interval);
  }, []);

  const progress = (time % COLOR_CYCLE_DURATION_MS) / COLOR_CYCLE_DURATION_MS;
  const currentColor = gradient.rgbAt(progress).toHexString() as HexColor;

  return (
    <Text color={currentColor}>
      {FRAMES[frameIndex]}
    </Text>
  );
};
