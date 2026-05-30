import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { PROVIDERS, getApiKeyEnvVar } from '@deepicode/core';

interface ModelPickerProps {
  currentProvider: string;
  currentModel: string;
  onSelect: (config: { provider: string; model: string; apiKey: string; baseUrl: string }) => void;
  onCancel: () => void;
}

type Step = 'provider' | 'model' | 'key' | 'custom_url' | 'custom_model';

export function ModelPicker({ currentProvider, currentModel, onSelect, onCancel }: ModelPickerProps) {
  const providerKeys = Object.keys(PROVIDERS);
  const [step, setStep] = useState<Step>('provider');
  const [selIdx, setSelIdx] = useState(Math.max(0, providerKeys.indexOf(currentProvider)));
  const [selProvider, setSelProvider] = useState(currentProvider);
  const [selModel, setSelModel] = useState(currentModel);
  const [apiKey, setApiKey] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [inputBuf, setInputBuf] = useState('');

  const confirmSelection = useCallback(() => {
    const cfg = PROVIDERS[selProvider];
    const existingKey = process.env[getApiKeyEnvVar(selProvider)] ?? process.env.DEEPSEEK_API_KEY ?? '';
    onSelect({
      provider: selProvider,
      model: selModel || cfg.model,
      apiKey: apiKey || existingKey,
      baseUrl: selProvider === 'custom' ? customUrl : cfg.baseUrl,
    });
  }, [selProvider, selModel, apiKey, customUrl, onSelect]);

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
        setSelIdx(prev => Math.min(providerKeys.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const p = providerKeys[selIdx];
        setSelProvider(p);
        setSelModel(PROVIDERS[p].models[0] ?? '');
        setInputBuf('');
        if (p === 'custom') {
          setStep('custom_url');
        } else if (PROVIDERS[p].requiresKey && !process.env[getApiKeyEnvVar(p)] && !process.env.DEEPSEEK_API_KEY) {
          setStep('key');
        } else {
          setStep('model');
        }
        return;
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
        const m = models[selIdx] ?? selModel;
        setSelModel(m);
        confirmSelection();
        return;
      }
      return;
    }

    if (step === 'key') {
      if (key.return && inputBuf.length > 0) {
        setApiKey(inputBuf);
        setInputBuf('');
        setStep(selProvider === 'custom' ? 'custom_url' : 'model');
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

    if (step === 'custom_url') {
      if (key.return && inputBuf.length > 0) {
        setCustomUrl(inputBuf);
        setInputBuf('');
        setStep('custom_model');
        return;
      }
      if (key.backspace || key.delete) {
        setInputBuf(prev => prev.slice(0, -1));
        return;
      }
      if (_input) {
        setInputBuf(prev => prev + _input);
      }
      return;
    }

    if (step === 'custom_model') {
      if (key.return && inputBuf.length > 0) {
        setCustomModel(inputBuf);
        setSelModel(inputBuf);
        setInputBuf('');
        setApiKey(apiKey || process.env[getApiKeyEnvVar('custom')] || '');
        confirmSelection();
        return;
      }
      if (key.backspace || key.delete) {
        setInputBuf(prev => prev.slice(0, -1));
        return;
      }
      if (_input) {
        setInputBuf(prev => prev + _input);
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
          {providerKeys.map((p, i) => (
            <Box key={p}>
              <Text>{i === selIdx ? '❯ ' : '  '}</Text>
              <Text bold={i === selIdx}>{PROVIDERS[p].label}</Text>
              {p === currentProvider && <Text dimColor> (current)</Text>}
            </Box>
          ))}
        </Box>
      )}

      {step === 'model' && (
        <Box flexDirection="column">
          <Text dimColor>{providerName} — select model (↑↓ Enter):</Text>
          {models.map((m, i) => (
            <Box key={m}>
              <Text>{i === selIdx ? '❯ ' : '  '}</Text>
              <Text bold={i === selIdx}>{m}</Text>
              {m === currentModel && <Text dimColor> (current)</Text>}
            </Box>
          ))}
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column">
          <Text dimColor>Enter API key for {providerName}:</Text>
          <Text>  {"*".repeat(inputBuf.length)}{inputBuf.length > 0 ? '▊' : ''}</Text>
        </Box>
      )}

      {step === 'custom_url' && (
        <Box flexDirection="column">
          <Text dimColor>Enter base URL (e.g. https://api.example.com):</Text>
          <Text>  {inputBuf}{'▊'}</Text>
        </Box>
      )}

      {step === 'custom_model' && (
        <Box flexDirection="column">
          <Text dimColor>Enter model name:</Text>
          <Text>  {inputBuf}{'▊'}</Text>
        </Box>
      )}
    </Box>
  );
}
