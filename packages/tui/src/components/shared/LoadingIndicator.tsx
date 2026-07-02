/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copied from gemini-cli/packages/cli/src/ui/components/LoadingIndicator.tsx
 * and adapted for Deepreef TUI.
 *
 * Changes from Gemini:
 * - Removed @google/gemini-cli-core import (ThoughtSummary type inlined)
 * - Replaced useStreamingContext/StreamingState with `streamingState` prop
 * - Uses useTerminalSize from @covalo/ink
 * - Uses getSemanticColors() for theme colors
 * - Uses local formatDuration helper
 * - Removed INTERACTIVE_SHELL_WAITING_PHRASE constant (not applicable)
 * - Removed isNarrowWidth utility (inline implementation)
 */

import type React from 'react';
import { Box, Text, useTerminalSize, type HexColor } from '@covalo/ink';
import { getSemanticColors } from '../../theme/semantic-colors.js';
import { RespondingSpinner, type SpinnerState } from './RespondingSpinner.js';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

interface LoadingIndicatorProps {
  streamingState?: SpinnerState;
  currentLoadingPhrase?: string;
  wittyPhrase?: string;
  showWit?: boolean;
  elapsedTime?: number;
  inline?: boolean;
  rightContent?: React.ReactNode;
  showCancelAndTimer?: boolean;
  forceRealStatusOnly?: boolean;
  spinnerIcon?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  streamingState = 'idle',
  currentLoadingPhrase,
  wittyPhrase,
  showWit = false,
  elapsedTime = 0,
  inline = false,
  rightContent,
  showCancelAndTimer = true,
  forceRealStatusOnly = false,
  spinnerIcon,
}) => {
  const { columns: terminalWidth } = useTerminalSize();
  const theme = getSemanticColors();
  const isNarrow = terminalWidth < 60;

  if (streamingState === 'idle' && !currentLoadingPhrase) {
    return null;
  }

  const primaryText =
    currentLoadingPhrase ||
    (streamingState === 'responding' ? 'Thinking...' : undefined);

  const cancelAndTimerContent =
    showCancelAndTimer && streamingState === 'responding'
      ? `(esc to cancel, ${elapsedTime < 60 ? `${elapsedTime}s` : formatDuration(elapsedTime * 1000)})`
      : null;

  const wittyPhraseNode =
    !forceRealStatusOnly &&
    showWit &&
    wittyPhrase &&
    primaryText === 'Thinking...' ? (
      <Box marginLeft={1}>
        <Text color={theme.text.secondary as HexColor} dimColor italic>
          {wittyPhrase}
        </Text>
      </Box>
    ) : null;

  if (inline) {
    return (
      <Box>
        <Box marginRight={1}>
          <RespondingSpinner
            state={streamingState}
            nonRespondingDisplay={
              spinnerIcon ??
              (streamingState === 'loading' ? '⠏' : '')
            }
          />
        </Box>
        {primaryText && (
          <Box flexShrink={1}>
            <Text color={theme.text.primary as HexColor} italic wrap="truncate-end">
              {primaryText}
            </Text>
          </Box>
        )}
        {cancelAndTimerContent && (
          <>
            <Box flexShrink={0} width={1} />
            <Text color={theme.text.secondary as HexColor}>{cancelAndTimerContent}</Text>
          </>
        )}
        {wittyPhraseNode}
      </Box>
    );
  }

  return (
    <Box paddingLeft={0} flexDirection="column">
      <Box
        width="100%"
        flexDirection={isNarrow ? 'column' : 'row'}
        alignItems={isNarrow ? 'flex-start' : 'center'}
      >
        <Box>
          <Box marginRight={1}>
            <RespondingSpinner
              state={streamingState}
              nonRespondingDisplay={
                spinnerIcon ??
                (streamingState === 'loading' ? '⠏' : '')
              }
            />
          </Box>
          {primaryText && (
            <Box flexShrink={1}>
              <Text color={theme.text.primary as HexColor} italic wrap="truncate-end">
                {primaryText}
              </Text>
            </Box>
          )}
          {!isNarrow && cancelAndTimerContent && (
            <>
              <Box flexShrink={0} width={1} />
              <Text color={theme.text.secondary as HexColor}>{cancelAndTimerContent}</Text>
            </>
          )}
          {!isNarrow && wittyPhraseNode}
        </Box>
        {!isNarrow && <Box flexGrow={1}>{/* Spacer */}</Box>}
        {!isNarrow && rightContent && <Box>{rightContent}</Box>}
      </Box>
      {isNarrow && cancelAndTimerContent && (
        <Box>
          <Text color={theme.text.secondary as HexColor}>{cancelAndTimerContent}</Text>
        </Box>
      )}
      {isNarrow && wittyPhraseNode}
      {isNarrow && rightContent && <Box>{rightContent}</Box>}
    </Box>
  );
};
