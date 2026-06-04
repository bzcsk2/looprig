/**
 * StreamingCard — 流式输出卡片
 * 实时显示 AI 模型正在生成的文本，包含动画 Spinner 和 token/秒 速率估算。
 * 输入参数：
 *   - text: string，当前已收到的流式文本内容
 *   - done?: boolean，流式输出是否已完成
 *   - aborted?: boolean，用户是否主动终止了流式输出
 *   - startTs: number，流开始时间戳（毫秒），用于计算经过时间和速率
 *   - expanded?: boolean，是否展开显示更多行（默认显示预览行数）
 * 内部行为：
 *   - 通过 useInterval 每秒触发重渲染，更新速率显示
 *   - 完成回复和未完成的流式输出使用不同的视觉模板
 */

import { Box, Text, useInterval } from '@deepicode/ink';
import React, { useState, useRef, useMemo } from 'react';
import { Card } from './Card.js';
import { CardHeader } from './CardHeader.js';
import { Spinner } from './Spinner.js';
import { Markdown } from './markdown.js';
import { clipToCells } from './text-width.js';
import { FG, TONE } from './tokens.js';
import { t } from '../i18n/index.js';

// PREVIEW_LINES: 折叠模式预览行数；EXPANDED_MAX_LINES: 展开模式最大行数
const PREVIEW_LINES = 4;
const EXPANDED_MAX_LINES = 60;
const CHARS_PER_TOKEN = 4;
const MIN_MS_FOR_RATE = 500;   // 至少要经过 500ms 才开始估算速率，避免短时数据波动
const MIN_CHARS_FOR_RATE = 20; // 至少累积 20 个字符才开始估算速率，避免样本量过小

interface StreamingCardProps {
  text: string;
  done?: boolean;
  aborted?: boolean;
  startTs: number;
  expanded?: boolean;
}

/**
 * 估算文本的 token 数量（粗略估算，按每 CHARS_PER_TOKEN 个字符=1 token）
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 将文本按指定宽度换行，支持中英文字符混合场景
 * @param text 原始文本
 * @param width 每行最大字符数
 * @returns 换行后的行数组
 */
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

/**
 * 格式化 token 速率显示
 * 超过 1000 token/s 时显示为 k 单位（如 1.2k）
 */
function formatRate(tps: number | null): string {
  if (tps === null) return '';
  if (tps >= 1000) return t().tps(`${(tps / 1000).toFixed(1)}k`);
  return t().tps(`${tps}`);
}

export function StreamingCard({ text, done = false, aborted = false, startTs, expanded = false }: StreamingCardProps): React.ReactElement {
  // 每 1000ms 触发一次重渲染，用于更新经过时间和速率显示
  const [, setTick] = useState(0);
  useInterval(() => setTick(t => t + 1), 1000);

  const now = Date.now();
  const elapsedMs = now - startTs;
  const tokens = estimateTokens(text);
  // 仅当经过时间和文本长度均超过阈值时才计算速率，避免短时采样偏差
  const tps = (elapsedMs >= MIN_MS_FOR_RATE && text.length >= MIN_CHARS_FOR_RATE)
    ? Math.round((tokens * 1000) / elapsedMs)
    : null;

  // 获取终端列数并计算每行可用字符数（减去两侧边距）
  const cols = process.stdout.columns ?? 80;
  const lineCells = Math.max(20, cols - 4);
  const allLines = useMemo(() => wrapLines(text, lineCells), [text, lineCells]);

  const headColor = aborted ? TONE.err : TONE.brand;
  const glyph = aborted ? '\u2298' : '\u25CF';
  const headLabel = aborted ? t().aborted : t().writing;

  // 已完成且未终止：显示完整的 Markdown 渲染结果，不再展示 Spinner
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
