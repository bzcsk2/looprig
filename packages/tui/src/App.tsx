import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Box, Text, AlternateScreen } from '@deepicode/ink';
import type { ReasonixEngine } from '@deepicode/core';
import type { DeepicodeConfig } from '@deepicode/core';
import { createBridge, type BridgeState } from './bridge.js';
import { DeepiMessages } from './DeepiMessages.js';
import { DeepiPromptInput } from './DeepiPromptInput.js';
import { ToolCallBanner } from './ToolCallBanner.js';
import { Spinner } from './Spinner.js';
import { StatusBar } from './StatusBar.js';
import { FullscreenLayout } from './FullscreenLayout.js';
import { isFullscreenEnvEnabled } from './fullscreen.js';

const initialState: BridgeState = {
  messages: [],
  isLoading: false,
  streamingText: null,
  reasoningText: null,
  activeTools: new Map(),
  tokens: { input: 0, output: 0 },
  warnings: [],
  error: null,
};

const PROVIDER_LABEL: Record<string, string> = {
  'https://api.deepseek.com': 'DeepSeek',
  'https://opencode.ai/zen/v1': 'Zen',
};

function getProviderLabel(config: DeepicodeConfig): string {
  return PROVIDER_LABEL[config.baseUrl] ?? config.baseUrl;
}

interface AppProps {
  engine: ReasonixEngine;
  config: DeepicodeConfig;
}

export function App({ engine, config }: AppProps) {
  const [bridgeState, setBridgeState] = useState<BridgeState>(initialState);
  const bridge = useMemo(() => createBridge(engine, setBridgeState), [engine]);
  const scrollRef = useRef<any>(null);

  const shuttingDown = useRef(false);
  const engineRef = useRef(engine);

  const handleSubmit = useCallback((text: string) => {
    if (text === '/exit' || text === '/bye') {
      shuttingDown.current = true;
      engineRef.current.interrupt();
      setBridgeState(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'assistant' as const, content: 'Shutting down...' }],
      }));
      setTimeout(() => process.exit(0), 300);
      return;
    }
    if (text === '/help') {
      setBridgeState(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'assistant' as const, content: 'Commands: /exit, /bye, /help' }],
      }));
      return;
    }
    bridge.submit(text);
  }, [bridge]);

  const providerLabel = getProviderLabel(config);

  const scrollableContent = (
    <>
      <DeepiMessages
        messages={bridgeState.messages}
        activeTools={bridgeState.activeTools}
        isLoading={bridgeState.isLoading}
        streamingText={bridgeState.streamingText}
        reasoningText={bridgeState.reasoningText}
        scrollRef={scrollRef}
      />
      <ToolCallBanner activeTools={bridgeState.activeTools} />
      <Spinner loading={bridgeState.isLoading} message={bridgeState.isLoading ? 'thinking...' : undefined} />
      {bridgeState.warnings.map((w, i) => (
        <Box key={i} paddingX={1}>
          <Text color="warning">⚠ {w}</Text>
        </Box>
      ))}
      {bridgeState.error && (
        <Box paddingX={1} marginTop={1}>
          <Text color="error">✗ {bridgeState.error}</Text>
        </Box>
      )}
    </>
  );

  const bottomContent = (
    <Box flexDirection="column" width="100%">
      <DeepiPromptInput
        onSubmit={handleSubmit}
        isLoading={bridgeState.isLoading}
      />
      <StatusBar
        model={config.model}
        provider={providerLabel}
        inputTokens={bridgeState.tokens.input}
        outputTokens={bridgeState.tokens.output}
      />
    </Box>
  );

  if (isFullscreenEnvEnabled()) {
    return (
      <AlternateScreen mouseTracking>
        <FullscreenLayout
          scrollRef={scrollRef}
          scrollable={scrollableContent}
          bottom={bottomContent}
        />
      </AlternateScreen>
    );
  }

  return (
    <>
      {scrollableContent}
      {bottomContent}
    </>
  );
}
