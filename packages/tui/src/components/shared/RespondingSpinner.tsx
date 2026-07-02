/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copied from gemini-cli/packages/cli/src/ui/components/GeminiRespondingSpinner.tsx
 * and adapted for Deepreef TUI.
 *
 * Changes from Gemini:
 * - Removed StreamingContext/StreamingState dependency (not available in Deepreef)
 * - Uses `state` prop instead of useStreamingContext() hook
 * - Replaced GeminiSpinner import with GradientSpinner
 * - Uses getSemanticColors() for theme colors
 */

import type React from 'react';
import { Text, type HexColor } from '@covalo/ink';
import { getSemanticColors } from '../../theme/semantic-colors.js';
import { GradientSpinner } from './GradientSpinner.js';

export type SpinnerState = 'responding' | 'loading' | 'idle';

interface RespondingSpinnerProps {
  state?: SpinnerState;
  nonRespondingDisplay?: string;
  color?: string;
}

export const RespondingSpinner: React.FC<RespondingSpinnerProps> = ({
  state = 'idle',
  nonRespondingDisplay,
  color,
}) => {
  const theme = getSemanticColors();

  if (state === 'responding') {
    return <GradientSpinner altText="Thinking..." />;
  }

  if (nonRespondingDisplay) {
    return (
      <Text color={(color ?? theme.text.primary) as HexColor}>
        {nonRespondingDisplay}
      </Text>
    );
  }

  return null;
};
