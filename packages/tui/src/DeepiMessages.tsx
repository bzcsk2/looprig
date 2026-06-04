/**
 * DeepiMessages — 消息列表主组件
 * 负责渲染对话时间线中的所有消息与交互卡片。
 * 输入参数：
 *   - timeline: TimelineItem[]，对话时间线数组，包含纯消息和 turn（助手工作单元）两种类型
 * 内部状态：
 *   - detailsOpen: boolean，全局控制是否展开推理过程、工具调用等细节面板
 */
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

/**
 * 格式化工具调用的输出内容
 * - 对 bash/shell 类工具，将 JSON stdout/stderr 合并为纯文本
 * - 对 list_dir 工具，将文件/目录列表格式化为行文本
 * - 包含 message/error/content 字段的 JSON 直接提取字符串值
 * - 兜底返回原始 output 字符串
 */
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

/**
 * 消息正文渲染组件
 * 将纯文本通过 Markdown 解析器渲染为格式化内容。
 * 使用 useMemo 缓存解析结果，避免 text 未变化时重复解析。
 */
function MessageContent({ text }: { text: string }) {
  const tokens = useMemo(() => text, [text]);
  if (!tokens) return null;
  return <Markdown text={tokens} />;
}

/**
 * ReasoningCard — 思考过程卡片
 * 显示模型的推理/思考过程，用户可通过打开/关闭控制详细内容的可见性。
 * 输入参数：
 *   - text: string，推理文本内容
 *   - isOpen: boolean，是否展开显示详情
 * 视觉说明：
 *   - 折叠时仅显示标题行和 ▶ 图标，右侧提示按 Ctrl+O 展开
 *   - 展开时 ▼ 图标 + 缩进的灰色文本显示详细推理
 */
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

/**
 * ToolUseSection — 工具调用列表区域
 * 展示同一次助手回复中执行的所有工具调用。
 * 输入参数：
 *   - tools: ToolStatus[]，该次回复中的工具调用列表
 *   - isOpen: boolean，是否展开显示详情
 * 内部处理：
 *   - 遍历 tools，将每个 ToolStatus 转为 ToolCardData 传给 ToolCard 组件
 *   - 根据 tool.status 决定 exitCode：error 状态为 1，done 为 0，running 则 undefined
 */
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

/**
 * PlainMessage — 单条消息渲染组件
 * 处理 user 和 assistant 两种角色的消息显示。
 * 输入参数：
 *   - message: ChatMessage，包含 role、content、reasoning_content 等字段
 *   - detailsOpen?: boolean，是否展开推理过程详情
 * 视觉说明：
 *   - 用户消息: 带背景色 (SURFACE.bgInput) 的卡片，❯ 图标 + brand 色
 *   - 助手消息: 包含可折叠的推理卡片 + 正文内容卡片
 */
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

/**
 * Turn — 单个完整助手工作单元
 * 展示一次助手回复的完整生命周期：用户问题 → 推理过程 → 工具调用 → 流式/完整回复。
 * 输入参数：
 *   - turn: TurnView，包含用户文本、助手文本、推理文本、流式文本、工具调用列表、时间戳等
 *   - detailsOpen: boolean，全局控制推理和工具调用的展开状态
 * 状态分支说明：
 *   - showDetails = isLoading || detailsOpen — 加载中总是显示详情
 *   - streamingText !== null → 使用 StreamingCard 实时展示；否则使用完整回复卡片
 *   - 仅当加载中且没有任何内容时显示纯 Spinner
 */
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
  // detailsOpen: 全局控制所有推理/工具详情区域的展开与折叠
  const [detailsOpen, setDetailsOpen] = useState(false);

  // 监听 Ctrl+O 快捷键，切换详情展开状态
  // \x0f 是 Ctrl+O 的 ASCII 码，同时也显式检查 key.ctrl && input === 'o'
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
