import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Box, Text, AlternateScreen } from '@deepicode/ink';
import type { ReasonixEngine } from '@deepicode/core';
import type { DeepicodeConfig } from '@deepicode/core';
import { PROVIDERS } from '@deepicode/core';
import { createBridge, type BridgeState } from './bridge.js';
import { DeepiMessages } from './DeepiMessages.js';
import { DeepiPromptInput } from './DeepiPromptInput.js';
import { ToolCallBanner } from './ToolCallBanner.js';
import { Spinner } from './Spinner.js';
import { StatusBar } from './StatusBar.js';
import { FullscreenLayout } from './FullscreenLayout.js';
import { isFullscreenEnvEnabled } from './fullscreen.js';
import { ModelPicker } from './ModelPicker.js';

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

export function getProviderLabel(provider: string, model: string): string {
  const info = PROVIDERS[provider];
  return info ? `${info.label} / ${model}` : `${provider} / ${model}`;
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

  const [activeProvider, setActiveProvider] = useState(config.provider ?? 'zen');
  const [activeModel, setActiveModel] = useState(config.model);
  const [showModelPicker, setShowModelPicker] = useState(false);

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
        messages: [...prev.messages, { role: 'assistant' as const, content: 'Commands: /exit, /bye, /help, /model' }],
      }));
      return;
    }
    if (text === '/model') {
      setShowModelPicker(true);
      return;
    }
    bridge.submit(text);
  }, [bridge]);

  const handleModelSelect = useCallback((sel: { provider: string; model: string; apiKey: string; baseUrl: string }) => {
    engineRef.current.updateConfig({
      provider: sel.provider,
      model: sel.model,
      apiKey: sel.apiKey,
      baseUrl: sel.baseUrl,
    });
    setActiveProvider(sel.provider);
    setActiveModel(sel.model);
    setShowModelPicker(false);
    setBridgeState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'assistant' as const, content: `Switched to ${PROVIDERS[sel.provider]?.label ?? sel.provider} / ${sel.model}` }],
    }));
  }, []);

  const handleModelCancel = useCallback(() => {
    setShowModelPicker(false);
  }, []);

  const providerLabel = getProviderLabel(activeProvider, activeModel);

  if (showModelPicker) {
    return (
      <Box flexDirection="column" width="100%" height="100%">
        <ModelPicker
          currentProvider={activeProvider}
          currentModel={activeModel}
          onSelect={handleModelSelect}
          onCancel={handleModelCancel}
        />
      </Box>
    );
  }

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
        model={activeModel}
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
