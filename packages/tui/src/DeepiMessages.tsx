import React, { useState, memo, useMemo } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import type { ChatMessage } from '@deepicode/core';
import type { TimelineItem, ToolStatus, TurnView } from './bridge.js';
import { Markdown } from './MarkdownRenderer.js';
import { Card } from './reasonix/Card.js';
import { CardHeader } from './reasonix/CardHeader.js';
import { Spinner } from './reasonix/Spinner.js';
import { StreamingCard } from './reasonix/StreamingCard.js';
import { ToolCard, type ToolCardData } from './reasonix/ToolCard.js';
import { FG, SURFACE, TONE } from './reasonix/tokens.js';
import { t } from './i18n/index.js';

interface DeepiMessagesProps {
  timeline: TimelineItem[];
  scrollRef?: React.RefObject<any>;
}

function formatToolOutput(tool: ToolStatus): string {
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(tool.output); } catch {}

  if (tool.name === 'bash' || tool.name === 'shell' || tool.name === 'shell_exec') {
    if (parsed) {
      const stdout = String(parsed.stdout ?? '');
      const stderr = String(parsed.stderr ?? '');
      return stdout + (stderr.trim() ? `\n${stderr}` : '');
    }
    return tool.output;
  }

  if (tool.name === 'list_dir' && parsed) {
    const items = parsed.items as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items)) {
      return items.map(item => item.type === 'dir' ? `${String(item.name ?? '')}/` : String(item.name ?? '')).join('\n');
    }
  }

  if (parsed) {
    const msg = parsed.message ?? parsed.error ?? parsed.content;
    if (typeof msg === 'string') return msg;
    return JSON.stringify(parsed, null, 2);
  }

  return tool.output;
}

function MessageContent({ text }: { text: string }) {
  const tokens = useMemo(() => text, [text]);
  if (!tokens) return null;
  return <Markdown text={tokens} />;
}

const MemoizedReasoningCard = memo(function ReasoningCard({ text, isOpen }: { text: string; isOpen: boolean }) {
  return (
    <Card>
      <CardHeader
        glyph={isOpen ? '\u25BC' : '\u25B6'}
        tone={TONE.accent}
        title={t().thinking}
        right={!isOpen ? <Text dimColor>{t().ctrlO}</Text> : undefined}
      />
      {isOpen && (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={FG.sub} wrap="wrap">{text}</Text>
        </Box>
      )}
    </Card>
  );
});

const MemoizedToolUseSection = memo(function ToolUseSection({ tools, isOpen }: { tools: ToolStatus[]; isOpen: boolean }) {
  if (tools.length === 0) return null;
  return (
    <Card>
      <CardHeader
        glyph={isOpen ? '\u25BC' : '\u25B6'}
        tone={TONE.brand}
        title={t().toolUse}
        meta={[`${tools.length}`]}
        right={!isOpen ? <Text dimColor>{t().ctrlO}</Text> : undefined}
      />
      {isOpen && (
        <Box flexDirection="column" paddingLeft={2}>
          {tools.map(tool => {
            const card: ToolCardData = {
              id: tool.key,
              name: tool.name,
              args: tool.args,
              output: formatToolOutput(tool),
              exitCode: tool.status === 'error' ? 1 : tool.status === 'done' ? 0 : undefined,
              done: tool.status !== 'running',
              elapsedMs: tool.elapsedMs,
            };
            return <ToolCard key={tool.key} card={card} isInflight={tool.status === 'running'} />;
          })}
        </Box>
      )}
    </Card>
  );
});

const MemoizedPlainMessage = memo(function PlainMessage({ message, detailsOpen = false }: { message: ChatMessage; detailsOpen?: boolean }) {
  if (message.role === 'user') {
    return (
      <Card>
        <Box flexDirection="row" backgroundColor={SURFACE.bgInput} paddingX={1} paddingY={1}>
          <Text bold color={TONE.brand}>{'\u276F '}</Text>
          <Box flexGrow={1}><MessageContent text={message.content ?? ''} /></Box>
        </Box>
      </Card>
    );
  }
  if (message.role === 'assistant') {
    return (
      <>
        {message.reasoning_content && (
          <MemoizedReasoningCard text={message.reasoning_content} isOpen={detailsOpen} />
        )}
        <Card>
          <Box flexDirection="column" paddingX={1} paddingY={1}>
            <CardHeader glyph="\u2022" tone={TONE.ok} title={t().assistant} />
            <Box paddingLeft={2}><MessageContent text={message.content ?? ''} /></Box>
          </Box>
        </Card>
      </>
    );
  }
  return null;
});

const MemoizedTurn = memo(function Turn({ turn, detailsOpen }: { turn: TurnView; detailsOpen: boolean }) {
  const showDetails = turn.isLoading || detailsOpen;
  const userMsg = useMemo<ChatMessage>(() => ({ role: 'user', content: turn.userText }), [turn.userText]);
  const assistantMsg = useMemo<ChatMessage | null>(
    () => turn.assistantText ? { role: 'assistant', content: turn.assistantText } : null,
    [turn.assistantText]
  );

  return (
    <Box flexDirection="column">
      <MemoizedPlainMessage message={userMsg} />
      {turn.reasoningText && <MemoizedReasoningCard text={turn.reasoningText} isOpen={showDetails} />}
      <MemoizedToolUseSection tools={turn.tools} isOpen={showDetails} />
      {(turn.streamingText !== null || assistantMsg) && (
        turn.streamingText !== null
          ? <StreamingCard text={turn.streamingText} startTs={turn.startTs} />
          : (
            <Card>
              <Box flexDirection="column" paddingX={1} paddingY={1}>
                <CardHeader glyph={'\u2039'} tone={TONE.ok} title={t().reply} />
                <Box paddingLeft={1}>
                  <MessageContent text={assistantMsg!.content ?? ''} />
                </Box>
              </Box>
            </Card>
          )
      )}
      {!turn.isLoading && turn.elapsedMs !== undefined && (
        <Box paddingLeft={1}>
          <Text color={FG.faint}>{`- Worked for ${(turn.elapsedMs / 1000).toFixed(1)}s `}</Text>
          <Text color={FG.faint}>{'\u2500'.repeat(12)}</Text>
        </Box>
      )}
      {turn.isLoading && turn.streamingText === null && !turn.reasoningText && turn.tools.length === 0 && (
        <Box>
          <Spinner kind="braille" color={TONE.brand} bold />
          <Text color={FG.sub}>{t().thinkingDots}</Text>
        </Box>
      )}
    </Box>
  );
});

export function DeepiMessages({ timeline }: DeepiMessagesProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  useInput((input, key) => {
    if (input === '\x0f' || (key.ctrl && input === 'o')) {
      setDetailsOpen(prev => !prev);
    }
  });

  const renderedItems = useMemo(() =>
    timeline.map(item =>
      item.kind === 'message'
        ? <MemoizedPlainMessage key={item.id} message={item.message} detailsOpen={detailsOpen} />
        : <MemoizedTurn key={item.id} turn={item.turn} detailsOpen={detailsOpen} />
    ),
    [timeline, detailsOpen]
  );

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {renderedItems}
    </Box>
  );
}
