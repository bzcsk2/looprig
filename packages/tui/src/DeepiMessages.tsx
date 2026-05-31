import React, { useState } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import type { ChatMessage } from '@deepicode/core';
import type { TimelineItem, ToolStatus, TurnView } from './bridge.js';
import { Markdown } from './MarkdownRenderer.js';
import { Card } from './reasonix/Card.js';
import { CardHeader } from './reasonix/CardHeader.js';
import { Spinner } from './reasonix/Spinner.js';
import { ToolCard, type ToolCardData } from './reasonix/ToolCard.js';
import { FG, SURFACE, TONE } from './reasonix/tokens.js';

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
  if (!text) return null;
  return <Markdown text={text} />;
}

function ReasoningCard({ text, isOpen }: { text: string; isOpen: boolean }) {
  return (
    <Card>
      <CardHeader
        glyph={isOpen ? '\u25BC' : '\u25B6'}
        tone={TONE.accent}
        title="Thinking"
        right={!isOpen ? <Text dimColor>ctrl+o</Text> : undefined}
      />
      {isOpen && (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={FG.sub} wrap="wrap">{text}</Text>
        </Box>
      )}
    </Card>
  );
}

function ToolUseSection({ tools, isOpen }: { tools: ToolStatus[]; isOpen: boolean }) {
  if (tools.length === 0) return null;
  return (
    <Card>
      <CardHeader
        glyph={isOpen ? '\u25BC' : '\u25B6'}
        tone={TONE.brand}
        title="Tool use"
        meta={[`${tools.length}`]}
        right={!isOpen ? <Text dimColor>ctrl+o</Text> : undefined}
      />
      {isOpen && (
        <Box flexDirection="column" paddingLeft={2}>
          {tools.map(tool => {
            const card: ToolCardData = {
              id: tool.key,
              name: tool.name,
              args: tool.args,
              output: tool.status === 'error' ? formatToolOutput(tool) : '',
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
}

function PlainMessage({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <Card>
        <Box flexDirection="column" backgroundColor={SURFACE.bgElev} paddingX={1} paddingY={1}>
          <CardHeader glyph="\u25C7" tone={TONE.brand} title="You" />
          <Box paddingLeft={1}><MessageContent text={message.content ?? ''} /></Box>
        </Box>
      </Card>
    );
  }
  if (message.role === 'assistant') {
    return (
      <Card>
        <CardHeader glyph="\u25CF" tone={TONE.ok} title="Assistant" />
        <Box paddingLeft={1}><MessageContent text={message.content ?? ''} /></Box>
      </Card>
    );
  }
  return null;
}

function Turn({ turn, detailsOpen }: { turn: TurnView; detailsOpen: boolean }) {
  const showDetails = turn.isLoading || detailsOpen;
  return (
    <Box flexDirection="column">
      <PlainMessage message={{ role: 'user', content: turn.userText }} />
      {turn.reasoningText && <ReasoningCard text={turn.reasoningText} isOpen={showDetails} />}
      <ToolUseSection tools={turn.tools} isOpen={showDetails} />
      {(turn.streamingText !== null || turn.assistantText) && (
        <Card>
          <CardHeader
            glyph="\u25CF"
            tone={TONE.ok}
            title="Assistant"
            right={turn.streamingText !== null ? <Spinner kind="braille" color={TONE.brand} bold /> : undefined}
          />
          <Box paddingLeft={1}>
            {turn.streamingText !== null
              ? <Text wrap="wrap">{turn.streamingText}<Text color={TONE.ok}>{'\u258A'}</Text></Text>
              : <MessageContent text={turn.assistantText} />}
          </Box>
        </Card>
      )}
      {turn.isLoading && turn.streamingText === null && !turn.reasoningText && turn.tools.length === 0 && (
        <Box>
          <Spinner kind="braille" color={TONE.brand} bold />
          <Text color={FG.sub}> thinking...</Text>
        </Box>
      )}
    </Box>
  );
}

export function DeepiMessages({ timeline }: DeepiMessagesProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  useInput((input, key) => {
    if (input === '\x0f' || (key.ctrl && input === 'o')) {
      setDetailsOpen(prev => !prev);
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {timeline.map(item =>
        item.kind === 'message'
          ? <PlainMessage key={item.id} message={item.message} />
          : <Turn key={item.id} turn={item.turn} detailsOpen={detailsOpen} />
      )}
    </Box>
  );
}
