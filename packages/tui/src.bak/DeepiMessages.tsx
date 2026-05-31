import React, { useState } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import type { ChatMessage } from '@deepicode/core';
import type { ToolStatus, ToolCallRecord } from './bridge.js';
import { Markdown } from './MarkdownRenderer.js';

interface DeepiMessagesProps {
  messages: ChatMessage[];
  activeTools: Map<string, ToolStatus>;
  toolHistory: ToolCallRecord[];
  isLoading: boolean;
  streamingText: string | null;
  reasoningText?: string | null;
  scrollRef?: React.RefObject<any>;
}

const MAX_LINES = 3;

function formatToolOutput(tc: ToolCallRecord): { header: string; body: string } {
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(tc.output); } catch {}

  if (tc.name === 'bash' || tc.name === 'shell' || tc.name === 'shell_exec') {
    if (parsed) {
      const stdout = String(parsed.stdout ?? '');
      const stderr = String(parsed.stderr ?? '');
      return { header: tc.command ? `$ ${tc.command}` : tc.name, body: stdout + (stderr.trim() ? '\n' + stderr : '') };
    }
    return { header: tc.name, body: tc.output };
  }

  if (tc.name === 'list_dir' && parsed) {
    const items = parsed.items as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items)) {
      const list = items.map(item => {
        const name = String(item.name ?? '');
        return item.type === 'dir' ? `${name}/` : name;
      }).join('\n');
      return { header: `ls ${parsed.path ?? '.'}`, body: list };
    }
  }

  if (parsed) {
    const msg = parsed.message ?? parsed.error ?? parsed.content;
    if (typeof msg === 'string') return { header: tc.name, body: msg };
    return { header: tc.name, body: JSON.stringify(parsed, null, 2) };
  }

  return { header: tc.name, body: tc.output };
}

function formatActiveTool(tool: ToolStatus): string {
  const isBash = tool.name === 'bash' || tool.name === 'shell' || tool.name === 'shell_exec';
  if (isBash && tool.args?.command) return `$ ${tool.args.command}`;
  if (tool.args) {
    const keys = Object.keys(tool.args);
    if (keys.length <= 2) return `${tool.name} ${keys.map(k => `${k}=${JSON.stringify(tool.args![k])}`).join(' ')}`;
  }
  return tool.name;
}

function ThinkingBubble({ text, isOpen }: { text: string; isOpen: boolean }) {
  return (
    <Box backgroundColor="reasoningBackground" paddingX={1} paddingY={1} marginBottom={1} flexDirection="column">
      <Box flexDirection="row">
        <Text color="warning">{isOpen ? '\u25BC' : '\u25B6'}</Text>
        <Box marginLeft={1}>
          <Text bold color="warning">Thinking</Text>
        </Box>
      </Box>
      {isOpen ? (
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor color="warning" wrap="wrap">{text}</Text>
        </Box>
      ) : (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>ctrl+o open</Text>
        </Box>
      )}
    </Box>
  );
}

function ToolUseBubble({ activeTools, toolHistory, isOpen }: {
  activeTools: Map<string, ToolStatus>;
  toolHistory: ToolCallRecord[];
  isOpen: boolean;
}) {
  const hasContent = activeTools.size > 0 || toolHistory.length > 0;
  if (!hasContent) return null;

  // Collect all commands (running + completed)
  const commands: { text: string; isError?: boolean }[] = [];

  // Running tools
  Array.from(activeTools.values()).forEach(tool => {
    commands.push({ text: formatActiveTool(tool) });
  });

  // Completed tools: show command only (skip successful results, show errors)
  toolHistory.forEach(tc => {
    if (tc.isError) {
      // Show error output
      const { header, body } = formatToolOutput(tc);
      commands.push({ text: header, isError: true });
      if (body) commands.push({ text: body, isError: true });
    } else {
      // Show command only
      const { header } = formatToolOutput(tc);
      commands.push({ text: header });
    }
  });

  return (
    <Box backgroundColor="reasoningBackground" paddingX={1} paddingY={1} marginBottom={1} flexDirection="column">
      <Box flexDirection="row">
        <Text color="warning">{isOpen ? '\u25BC' : '\u25B6'}</Text>
        <Box marginLeft={1}>
          <Text bold color="warning">Tool use</Text>
        </Box>
      </Box>
      {isOpen ? (
        <Box marginTop={1} flexDirection="column">
          {commands.map((cmd, i) => (
            <Box key={i} paddingLeft={1}>
              <Text wrap="wrap" color={cmd.isError ? 'error' : undefined}>{cmd.text}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>ctrl+o open</Text>
        </Box>
      )}
    </Box>
  );
}

function MessageContent({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
  if (!text) return null;
  if (isStreaming) return <Text wrap="wrap">{text}</Text>;
  return <Markdown>{text}</Markdown>;
}

export function DeepiMessages({ messages, activeTools, toolHistory, isLoading, streamingText, reasoningText }: DeepiMessagesProps) {
  const [openSection, setOpenSection] = useState<'thinking' | 'tools' | null>(null);

  useInput((_input, key) => {
    if (_input === '\x0f' || (key.ctrl && _input === 'o')) {
      setOpenSection(prev => prev === 'thinking' ? null : 'thinking');
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {messages.map((msg, i) => {
        const key = msg.role + i;
        const isLast = i === messages.length - 1;

        if (msg.role === 'user') {
          return (
            <Box key={key} backgroundColor="userMessageBackground" paddingX={1} paddingY={1} marginBottom={1} flexDirection="column">
              <Box marginBottom={1}>
                <Text bold color="briefLabelYou">You</Text>
              </Box>
              <MessageContent text={msg.content ?? ''} />
            </Box>
          );
        }

        if (msg.role === 'assistant') {
          const hasThinking = isLast && !!reasoningText;
          const hasTools = isLast && (activeTools.size > 0 || toolHistory.length > 0);
          const showText = isLast ? (streamingText !== null || msg.content) : msg.content;

          return (
            <Box key={key} flexDirection="column">
              {hasThinking && <ThinkingBubble text={reasoningText!} isOpen={openSection === 'thinking'} />}
              {hasTools && <ToolUseBubble activeTools={activeTools} toolHistory={toolHistory} isOpen={openSection === 'tools'} />}
              {showText && (
                <Box paddingX={1} marginBottom={1}>
                  {isLast && streamingText !== null ? (
                    <Box>
                      <Text wrap="wrap">{streamingText}</Text>
                      <Text color="success">{'\u258A'}</Text>
                    </Box>
                  ) : (
                    <MessageContent text={msg.content ?? ''} />
                  )}
                </Box>
              )}
            </Box>
          );
        }

        return null;
      })}

      {isLoading && activeTools.size === 0 && toolHistory.length === 0 && !reasoningText && (
        <Box>
          <Text color="success">{'\u280B'} \u601D\u8003\u4E2D...</Text>
        </Box>
      )}
    </Box>
  );
}
