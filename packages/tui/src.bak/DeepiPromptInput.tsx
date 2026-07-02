import { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from '@covalo/ink';

interface DeepiPromptInputProps {
  onSubmit: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  queueCount?: number;
  onCancel: () => void;
}

const MAX_HISTORY = 100;

export function DeepiPromptInput({ onSubmit, isLoading, disabled, queueCount = 0, onCancel }: DeepiPromptInputProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const cursorRef = useRef(0);
  const escRef = useRef(0);

  const submitLine = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setHistory(prev => [text, ...prev].slice(0, MAX_HISTORY));
    setHistoryIdx(-1);
    setInput('');
    cursorRef.current = 0;
    onSubmit(text);
  }, [input, onSubmit]);

  useInput((_input, key) => {
    if (disabled) return;

    // Ctrl+C character (when raw mode works properly)
    if (_input === '\x03' || (key.ctrl && _input === 'c')) {
      if (isLoading) {
        onCancel();
      }
      return;
    }

    // Esc × 2 to interrupt during loading (Esc IS a key event, unlike Ctrl+C)
    if (key.escape && isLoading) {
      const now = Date.now();
      if (now - escRef.current < 800) {
        onCancel();
        escRef.current = 0;
        return;
      }
      escRef.current = now;
      return;
    }

    // Ctrl+O — toggle reasoning panel (handled by DeepiMessages)
    if (_input === '\x0f' || (key.ctrl && _input === 'o')) {
      return;
    }

    // --- Normal editing (works even during loading — messages are queued) ---
    if (key.return) {
      submitLine();
      return;
    }

    if (key.upArrow) {
      setHistoryIdx(prev => {
        const next = Math.min(prev + 1, history.length - 1);
        if (next >= 0) {
          setInput(history[next] ?? '');
          cursorRef.current = (history[next] ?? '').length;
        }
        return next;
      });
      return;
    }

    if (key.downArrow) {
      setHistoryIdx(prev => {
        const next = prev - 1;
        if (next < 0) {
          setInput('');
          cursorRef.current = 0;
          return -1;
        }
        setInput(history[next] ?? '');
        cursorRef.current = (history[next] ?? '').length;
        return next;
      });
      return;
    }

    if (key.leftArrow) {
      cursorRef.current = Math.max(0, cursorRef.current - 1);
      return;
    }

    if (key.rightArrow) {
      cursorRef.current = Math.min(input.length, cursorRef.current + 1);
      return;
    }

    if (_input === 'a' && key.ctrl) {
      cursorRef.current = 0;
      return;
    }

    if (_input === 'e' && key.ctrl) {
      cursorRef.current = input.length;
      return;
    }

    if (key.home) {
      cursorRef.current = 0;
      return;
    }

    if (key.end) {
      cursorRef.current = input.length;
      return;
    }

    if (key.backspace) {
      const pos = cursorRef.current;
      if (pos > 0) {
        setInput(prev => prev.slice(0, pos - 1) + prev.slice(pos));
        cursorRef.current = pos - 1;
      }
      return;
    }

    if (key.delete) {
      const pos = cursorRef.current;
      if (pos < input.length) {
        setInput(prev => prev.slice(0, pos) + prev.slice(pos + 1));
      }
      return;
    }

    if (_input === 'd' && key.ctrl) {
      const pos = cursorRef.current;
      if (pos < input.length) {
        setInput(prev => prev.slice(0, pos) + prev.slice(pos + 1));
      }
      return;
    }

    if (_input === 'u' && key.ctrl) {
      setInput('');
      cursorRef.current = 0;
      return;
    }

    if (_input === 'k' && key.ctrl) {
      const pos = cursorRef.current;
      setInput(prev => prev.slice(0, pos));
      return;
    }

    if (_input) {
      const pos = cursorRef.current;
      setInput(prev => prev.slice(0, pos) + _input + prev.slice(pos));
      cursorRef.current = pos + _input.length;
    }
  });

  const isPlaceholder = !input && !isLoading;
  const queueHint = queueCount > 0 ? ` (${queueCount} queued)` : '';
  const loadingHint = isLoading ? ' (processing...)' : '';
  const displayText = isPlaceholder && !isLoading && queueCount === 0
    ? '输入消息...'
    : `${input.slice(0, cursorRef.current)}▊${input.slice(cursorRef.current)}${queueHint}${loadingHint}`;

  return (
    <Box flexDirection="column" width="100%" borderStyle="round" paddingX={1}>
      <Text wrap="truncate-end" dimColor={isPlaceholder}>{displayText}</Text>
    </Box>
  );
}
