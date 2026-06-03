/** StreamingCard — adapted from Reasonix for deepicode.
 *  Shows live streaming text with Spinner and token/s estimation. */

import { Box, Text, useInterval } from '@deepicode/ink';
import React, { useState, useRef, useMemo } from 'react';
import { Card } from './Card.js';
import { CardHeader } from './CardHeader.js';
import { Spinner } from './Spinner.js';
import { Markdown } from './markdown.js';
import { clipToCells } from './text-width.js';
import { FG, TONE } from './tokens.js';
import { t } from '../i18n/index.js';

const PREVIEW_LINES = 4;
const EXPANDED_MAX_LINES = 60;
const CHARS_PER_TOKEN = 4;
const MIN_MS_FOR_RATE = 500;
const MIN_CHARS_FOR_RATE = 20;

interface StreamingCardProps {
  text: string;
  done?: boolean;
  aborted?: boolean;
  startTs: number;
  expanded?: boolean;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function wrapLines(text: string, width: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length <= width) { lines.push(line); continue; }
    let cur = '';
    for (const ch of line) {
      cur += ch;
      if (cur.length >= width) { lines.push(cur); cur = ''; }
    }
    if (cur) lines.push(cur);
  }
  return lines.length > 0 ? lines : [''];
}

function formatRate(tps: number | null): string {
  if (tps === null) return '';
  if (tps >= 1000) return t().tps(`${(tps / 1000).toFixed(1)}k`);
  return t().tps(`${tps}`);
}

export function StreamingCard({ text, done = false, aborted = false, startTs, expanded = false }: StreamingCardProps): React.ReactElement {
  // Re-render at 1Hz to keep rate updated
  const [, setTick] = useState(0);
  useInterval(() => setTick(t => t + 1), 1000);

  const now = Date.now();
  const elapsedMs = now - startTs;
  const tokens = estimateTokens(text);
  const tps = (elapsedMs >= MIN_MS_FOR_RATE && text.length >= MIN_CHARS_FOR_RATE)
    ? Math.round((tokens * 1000) / elapsedMs)
    : null;

  const cols = process.stdout.columns ?? 80;
  const lineCells = Math.max(20, cols - 4);
  const allLines = useMemo(() => wrapLines(text, lineCells), [text, lineCells]);

  const headColor = aborted ? TONE.err : TONE.brand;
  const glyph = aborted ? '\u2298' : '\u25CF';
  const headLabel = aborted ? t().aborted : t().writing;

  if (done && !aborted) {
    return (
      <Card>
        <CardHeader
          glyph={'\u2039'}
          tone={TONE.ok}
          title={t().reply}
          right={tps !== null ? <Text dimColor>{formatRate(tps)}</Text> : undefined}
        />
        <Markdown text={text} />
      </Card>
    );
  }

  const cap = expanded ? EXPANDED_MAX_LINES : PREVIEW_LINES;
  const visible = allLines.slice(-cap);
  const droppedAbove = Math.max(0, allLines.length - visible.length);

  return (
    <Card>
      <CardHeader
        glyph={glyph}
        tone={headColor}
        title={headLabel}
        right={
          <>
            {tps !== null && <Text dimColor>{formatRate(tps)}</Text>}
            {!aborted && <Spinner kind="braille" color={TONE.brand} />}
          </>
        }
      />
      {droppedAbove > 0 && (
        <Text color={FG.faint}>{t().linesDropped(droppedAbove)}</Text>
      )}
      {visible.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color={aborted ? FG.meta : FG.body}>{clipToCells(line, lineCells)}</Text>
          {!aborted && i === visible.length - 1 && <Text color={TONE.ok}>{'\u258A'}</Text>}
        </Box>
      ))}
      {aborted && <Text color={FG.faint}>{t().truncatedByEsc}</Text>}
    </Card>
  );
}
