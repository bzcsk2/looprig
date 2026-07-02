/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copied from gemini-cli/packages/cli/src/ui/components/ThemedGradient.tsx
 * and adapted for Deepreef TUI.
 *
 * Changes from Gemini:
 * - Replaced ink-gradient with tinygradient + tinycolor2 (available in Deepreef)
 * - Uses getSemanticColors() for theme gradient colors
 * - Renders gradient as a series of colored Text characters
 */

import type React from 'react';
import { Text } from '@covalo/ink';
import tinygradient from 'tinygradient';
import { getSemanticColors } from '../../theme/semantic-colors.js';

interface ThemedGradientProps {
  children: React.ReactNode;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  dimColor?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export const ThemedGradient: React.FC<ThemedGradientProps> = ({
  children,
  ...props
}) => {
  const theme = getSemanticColors();
  const gradientColors = theme.ui.gradient;

  const text = typeof children === 'string' ? children : '';
  if (!text || !gradientColors || gradientColors.length < 2) {
    const fallbackColor =
      gradientColors?.length === 1
        ? gradientColors[0]
        : theme.text.accent;
    return (
      <Text color={fallbackColor as any} {...props}>
        {children}
      </Text>
    );
  }

  const gradient = tinygradient(gradientColors);
  const chars = [...text];

  return (
    <>
      {chars.map((char, i) => {
        const progress = chars.length > 1 ? i / (chars.length - 1) : 0;
        const colorHex = gradient.rgbAt(progress).toHexString();
        return (
          <Text key={i} color={colorHex as any} {...props}>
            {char}
          </Text>
        );
      })}
    </>
  );
};
