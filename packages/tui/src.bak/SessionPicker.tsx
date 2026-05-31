import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { SessionLoader, type SessionSummary } from '@deepicode/core';

interface SessionPickerProps {
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function SessionPicker({ onSelect, onCancel }: SessionPickerProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    SessionLoader.list().then(s => {
      setSessions(s);
      setLoading(false);
    }).catch(e => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, []);

  const confirm = useCallback(() => {
    const s = sessions[selIdx];
    if (!s) return; // session list empty or selIdx out of bounds
    onSelect(s.id);
  }, [sessions, selIdx, onSelect]);

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelIdx(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelIdx(prev => sessions.length > 0 ? Math.min(sessions.length - 1, prev + 1) : 0);
      return;
    }
    if (key.return) {
      confirm();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" width="100%">
      <Box marginBottom={1}>
        <Text bold>Sessions</Text>
        <Text dimColor> (↑↓ select, Enter resume, Esc cancel)</Text>
      </Box>

      {loading && <Text dimColor>Loading...</Text>}
      {error && <Text color="error">Error: {error}</Text>}

      {!loading && !error && sessions.length === 0 && (
        <Text dimColor>No saved sessions found.</Text>
      )}

      {sessions.map((s, i) => (
        <Box key={s.id}>
          <Text>{i === selIdx ? '❯ ' : '  '}</Text>
          <Text bold={i === selIdx}>{s.id.slice(0, 8)}</Text>
          <Text> — {fmtTime(s.ts)}</Text>
          <Text dimColor> {s.userMessages} msgs</Text>
          <Text dimColor> in{fmtTokens(s.inputTokens)} out{fmtTokens(s.outputTokens)}</Text>
        </Box>
      ))}
    </Box>
  );
}
