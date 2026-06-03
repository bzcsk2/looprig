import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { t } from './i18n/index.js';
import { FG, SURFACE, TONE } from './reasonix/tokens.js';

interface DeepiPromptInputProps {
  onSubmit: (text: string) => void;
  onChange?: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  queueCount?: number;
  onCancel: () => void;
  /** When true, disable history navigation to let autocomplete handle keys */
  suppressHistory?: boolean;
}

export interface DeepiPromptInputHandle {
  writeText: (text: string) => void;
}

const MAX_HISTORY = 100;

/** Classify a character into a word class for boundary detection. */
function charClass(ch: string): number {
  if (!ch) return 0;
  const code = ch.codePointAt(0)!;
  if (code <= 32) return 1; // space/control
  if (code >= 0x4E00 && code <= 0x9FFF) return 2; // CJK
  if (code >= 0x3000 && code <= 0x303F) return 3; // CJK punctuation
  if (/[a-zA-Z0-9_]/.test(ch)) return 4; // word chars
  return 5; // other punctuation
}

/** Find the position of the previous word boundary (for Ctrl+Left / Ctrl+Backspace). */
function findWordLeft(text: string, pos: number): number {
  if (pos <= 0) return 0;
  // Skip spaces
  let i = pos - 1;
  while (i > 0 && charClass(text[i]) === 1) i--;
  // Skip word chars of the same class
  const cls = charClass(text[i]);
  while (i > 0 && charClass(text[i - 1]) === cls) i--;
  return i;
}

/** Find the position of the next word boundary (for Ctrl+Right). */
function findWordRight(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  // Skip word chars of the same class
  let i = pos;
  const cls = charClass(text[i]);
  while (i < text.length && charClass(text[i]) === cls) i++;
  // Skip spaces
  while (i < text.length && charClass(text[i]) === 1) i++;
  return i;
}

export const DeepiPromptInput = forwardRef<DeepiPromptInputHandle, DeepiPromptInputProps>(function DeepiPromptInput(
  { onSubmit, onChange, isLoading, disabled, queueCount = 0, onCancel, suppressHistory = false },
  ref
) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cursor, setCursor] = useState(0);
  const escRef = useRef(0);

  useImperativeHandle(ref, () => ({
    writeText: (text: string) => {
      setInput(text);
      setCursor(text.length);
    }
  }));

  useEffect(() => { onChange?.(input); }, [input, onChange]);

  const submitLine = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setHistory(prev => [text, ...prev].slice(0, MAX_HISTORY));
    setHistoryIdx(-1);
    setInput('');
    setCursor(0);
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

    // Ctrl+Enter — insert newline
    if (key.return && key.ctrl) {
      const pos = cursor;
      setInput(prev => prev.slice(0, pos) + '\n' + prev.slice(pos));
      setCursor(pos + 1);
      return;
    }

    // Enter — submit
    if (key.return) {
      submitLine();
      return;
    }

    if (key.upArrow) {
      if (!suppressHistory) {
        setHistoryIdx(prev => {
          const next = Math.min(prev + 1, history.length - 1);
          if (next >= 0) {
            setInput(history[next] ?? '');
            setCursor((history[next] ?? '').length);
          }
          return next;
        });
      }
      return;
    }

    if (key.downArrow) {
      if (!suppressHistory) {
        setHistoryIdx(prev => {
          const next = prev - 1;
          if (next < 0) {
            setInput('');
            setCursor(0);
            return -1;
          }
          setInput(history[next] ?? '');
          setCursor((history[next] ?? '').length);
          return next;
        });
      }
      return;
    }

    if (key.leftArrow) {
      setCursor(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor(prev => Math.min(input.length, prev + 1));
      return;
    }

    // Ctrl+Left: jump to previous word boundary
    if (key.leftArrow && key.ctrl) {
      setCursor(prev => findWordLeft(input, prev));
      return;
    }

    // Ctrl+Right: jump to next word boundary
    if (key.rightArrow && key.ctrl) {
      setCursor(prev => findWordRight(input, prev));
      return;
    }

    // Ctrl+Backspace: delete previous word
    if (key.backspace && key.ctrl) {
      const pos = cursor;
      const newCursor = findWordLeft(input, pos);
      if (newCursor < pos) {
        setInput(prev => prev.slice(0, newCursor) + prev.slice(pos));
        setCursor(newCursor);
      }
      return;
    }

    if (_input === 'a' && key.ctrl) {
      setCursor(0);
      return;
    }

    if (_input === 'e' && key.ctrl) {
      setCursor(input.length);
      return;
    }

    if (key.home) {
      setCursor(0);
      return;
    }

    if (key.end) {
      setCursor(input.length);
      return;
    }

    if (key.backspace) {
      const pos = cursor;
      if (pos > 0) {
        setInput(prev => prev.slice(0, pos - 1) + prev.slice(pos));
        setCursor(pos - 1);
      }
      return;
    }

    if (key.delete) {
      const pos = cursor;
      if (pos < input.length) {
        setInput(prev => prev.slice(0, pos) + prev.slice(pos + 1));
      }
      return;
    }

    if (_input === 'd' && key.ctrl) {
      const pos = cursor;
      if (pos < input.length) {
        setInput(prev => prev.slice(0, pos) + prev.slice(pos + 1));
      }
      return;
    }

    if (_input === 'u' && key.ctrl) {
      setInput('');
      setCursor(0);
      return;
    }

    if (_input === 'k' && key.ctrl) {
      const pos = cursor;
      setInput(prev => prev.slice(0, pos));
      return;
    }

    if (_input) {
      const pos = cursor;
      setInput(prev => prev.slice(0, pos) + _input + prev.slice(pos));
      setCursor(pos + _input.length);
    }
  });

  const isPlaceholder = !input && !isLoading;
  const queueHint = queueCount > 0 ? t().queued(queueCount) : '';
  const loadingHint = isLoading ? t().processing : '';
  const displayText = isPlaceholder && !isLoading && queueCount === 0
    ? t().placeholder
    : `${input.slice(0, cursor)}▊${input.slice(cursor)}${queueHint}${loadingHint}`;

  return (
    <Box flexDirection="row" width="100%" borderStyle="round" borderColor={TONE.accent} backgroundColor={SURFACE.bgInput} paddingX={1}>
      <Text bold color={TONE.brand}>{'\u276F '}</Text>
      <Text wrap="wrap" color={isPlaceholder ? FG.sub : FG.strong}>{displayText}</Text>
    </Box>
  );
});
