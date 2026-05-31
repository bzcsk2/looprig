/** ToolCard adapted from Reasonix for deepicode */

import { Box, Text } from '@deepicode/ink';
import React from 'react';
import { Markdown } from './markdown.js';
import { Card } from './Card.js';
import { CardHeader, type MetaItem } from './CardHeader.js';
import { Spinner } from './Spinner.js';
import { clipToCells } from './text-width.js';
import { FG, TONE } from './tokens.js';

const READ_TAIL = 2;
const OTHER_TAIL = 5;

function tailLinesFor(name: string): number {
  const lower = name.toLowerCase();
  return /(?:^|_)(read|search|list|tree|get|status|diff|fetch|grep)(_|$)/.test(lower) ? READ_TAIL : OTHER_TAIL;
}

export interface ToolCardData {
  id: string;
  name: string;
  args: unknown;
  output: string;
  exitCode?: number;
  done: boolean;
  rejected?: boolean;
  aborted?: boolean;
  elapsedMs?: number;
}

type ToolStatus = 'running' | 'ok' | 'rejected' | 'error' | 'aborted';

function toolStatus(card: ToolCardData, isInflight: boolean): ToolStatus {
  if (isInflight) return 'running';
  if (card.rejected) return 'rejected';
  if (card.aborted) return 'aborted';
  if (card.exitCode !== undefined && card.exitCode !== 0) return 'error';
  return 'ok';
}

function statusGlyph(s: ToolStatus): string {
  switch (s) { case 'running': return '\u25CF'; case 'ok': return '\u2713'; case 'rejected': case 'error': return '\u2717'; case 'aborted': return '\u2298'; }
}

function headerColorFor(s: ToolStatus): string {
  switch (s) { case 'ok': return TONE.ok; case 'rejected': case 'error': case 'aborted': return TONE.err; case 'running': return TONE.brand; }
}

function formatArgsSummary(args: unknown): string {
  if (typeof args === 'string') return args.length > 60 ? `${args.slice(0, 60)}\u2026` : args;
  if (args && typeof args === 'object') {
    const keys = Object.keys(args as Record<string, unknown>);
    if (keys.length === 0) return '';
    const first = keys[0]!;
    const value = (args as Record<string, unknown>)[first];
    if (typeof value === 'string') {
      const trimmed = value.length > 40 ? `${value.slice(0, 40)}\u2026` : value;
      return keys.length === 1 ? trimmed : `${trimmed}  +${keys.length - 1}`;
    }
    return keys.join(' ');
  }
  return '';
}

function selectPreviewLines(output: string, tailLines: number): string[] {
  if (!output) return [];
  const lines = output.split('\n');
  if (lines.length <= tailLines) return lines;
  return lines.slice(-tailLines);
}

export function ToolCard({ card, isInflight = false }: { card: ToolCardData; isInflight?: boolean }): React.ReactElement {
  const cols = process.stdout.columns ?? 80;
  const lineCells = Math.max(20, cols - 4);
  const argsLabel = formatArgsSummary(card.args);
  const status = toolStatus(card, isInflight);
  const headColor = headerColorFor(status);
  const tail = tailLinesFor(card.name);
  const preview = selectPreviewLines(card.output, tail);
  const showBody = !card.rejected && preview.length > 0;

  const meta: MetaItem[] = [];
  if (card.rejected) meta.push({ text: 'rejected', color: TONE.err });
  if (card.elapsedMs && card.elapsedMs > 0) meta.push(`${(card.elapsedMs / 1000).toFixed(2)}s`);
  if (card.done && !card.rejected && !card.aborted && card.exitCode !== undefined && card.exitCode !== 0) {
    meta.push({ text: `exit ${card.exitCode}`, color: TONE.err });
  }

  return (
    <Card tone={headColor}>
      <CardHeader
        glyph={statusGlyph(status)}
        tone={headColor}
        title={card.name}
        subtitle={argsLabel || undefined}
        meta={meta.length > 0 ? meta : undefined}
        right={status === 'running' ? <Spinner kind="braille" color={TONE.brand} bold /> : undefined}
      />
      {showBody && preview.map((line, i) => (
        <Text key={`${card.id}:line:${i}`} color={card.exitCode && card.exitCode !== 0 ? TONE.err : FG.sub}>
          {clipToCells(line, lineCells) || ' '}
        </Text>
      ))}
    </Card>
  );
}
