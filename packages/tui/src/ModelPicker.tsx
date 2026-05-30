import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { PROVIDERS, getApiKeyEnvVar } from '@deepicode/core';

interface ModelPickerProps {
  currentProvider: string;
  currentModel: string;
  onSelect: (config: { provider: string; model: string; apiKey: string; baseUrl: string }) => void;
  onCancel: () => void;
}

type Step = 'provider' | 'key' | 'model';

const PROVIDER_ORDER = ['zen', 'deepseek', 'mimo'];

export function ModelPicker({ currentProvider, currentModel, onSelect, onCancel }: ModelPickerProps) {
  const [step, setStep] = useState<Step>('provider');
  const [selIdx, setSelIdx] = useState(Math.max(0, PROVIDER_ORDER.indexOf(currentProvider)));
  const [selProvider, setSelProvider] = useState(currentProvider);
  const [selModel, setSelModel] = useState(currentModel);
  const [apiKey, setApiKey] = useState('');
  const [inputBuf, setInputBuf] = useState('');

  const confirmSelection = useCallback(() => {
    const cfg = PROVIDERS[selProvider];
    if (!cfg) return;
    const envKey = process.env[getApiKeyEnvVar(selProvider)] ?? '';
    onSelect({
      provider: selProvider,
      model: selModel || cfg.model,
      apiKey: apiKey || envKey || (cfg.defaultKey ?? ''),
      baseUrl: cfg.baseUrl,
    });
  }, [selProvider, selModel, apiKey, onSelect]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      onCancel();
      return;
    }

    if (step === 'provider') {
      if (key.upArrow) {
        setSelIdx(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelIdx(prev => Math.min(PROVIDER_ORDER.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const p = PROVIDER_ORDER[selIdx];
        setSelProvider(p);
        setSelModel(PROVIDERS[p].models[0]?.model ?? '');
        setInputBuf('');
        if (PROVIDERS[p].requiresKey && !PROVIDERS[p].defaultKey && !process.env[getApiKeyEnvVar(p)]) {
          setStep('key');
        } else {
          setStep('model');
        }
        return;
      }
      return;
    }

    if (step === 'key') {
      if (key.return && inputBuf.length > 0) {
        setApiKey(inputBuf);
        setInputBuf('');
        setSelIdx(0);
        setStep('model');
        return;
      }
      if (key.backspace || key.delete) {
        setInputBuf(prev => prev.slice(0, -1));
        return;
      }
      if (_input && _input.length === 1) {
        setInputBuf(prev => prev + _input);
      }
      return;
    }

    if (step === 'model') {
      const models = PROVIDERS[selProvider]?.models ?? [];
      if (key.upArrow) {
        setSelIdx(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelIdx(prev => Math.min(models.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const m = models[selIdx];
        if (m) {
          setSelModel(m.model);
          confirmSelection();
        }
        return;
      }
      return;
    }
  });

  const providerName = PROVIDERS[selProvider]?.label ?? selProvider;
  const models = PROVIDERS[selProvider]?.models ?? [];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" width="100%">
      <Box marginBottom={1}>
        <Text bold>Model Settings</Text>
      </Box>

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text dimColor>Select provider (↑↓ Enter, Ctrl+C to cancel):</Text>
          {PROVIDER_ORDER.map((p, i) => {
            const info = PROVIDERS[p];
            if (!info) return null;
            return (
              <Box key={p}>
                <Text>{i === selIdx ? '❯ ' : '  '}</Text>
                <Text bold={i === selIdx}>{info.label}</Text>
                {p === currentProvider && <Text dimColor> (current)</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column">
          <Text dimColor>Enter API key for {providerName}:</Text>
          <Text>  {"*".repeat(inputBuf.length)}{inputBuf.length > 0 ? '▊' : ''}</Text>
        </Box>
      )}

      {step === 'model' && (
        <Box flexDirection="column">
          <Text dimColor>{providerName} — select model (↑↓ Enter):</Text>
          {models.map((m, i) => (
            <Box key={m.model}>
              <Text>{i === selIdx ? '❯ ' : '  '}</Text>
              <Text bold={i === selIdx}>{m.label}</Text>
              {m.model === currentModel && <Text dimColor> (current)</Text>}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
