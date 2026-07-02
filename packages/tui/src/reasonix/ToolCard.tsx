/**
 * ToolCard — 工具调用结果卡片
 * 渲染单个工具调用的状态、参数摘要和输出预览。
 * 输入参数：
 *   - card: ToolCardData，包含工具调用的 id、名称(name)、参数(args)、输出(output)、
 *     退出码(exitCode)、完成状态(done)、是否被拒(rejected)等
 *   - isInflight?: boolean，该工具调用是否仍在执行中
 * 内部逻辑：
 *   - 根据执行状态显示不同图标（运行中/成功/拒绝/错误/终止）
 *   - 对 read/search 等只读工具显示较少的输出行，其他工具显示较多行
 *   - 非拒绝且输出非空时展示预览行
 */

import { Box, Text } from '@covalo/ink';
import React from 'react';
import { Markdown } from './markdown.js';
import { Card } from './Card.js';
import { CardHeader, type MetaItem } from './CardHeader.js';
import { Spinner } from './Spinner.js';
import { clipToCells } from './text-width.js';
import { FG, TONE } from './tokens.js';
import { t } from '../i18n/index.js';

const READ_TAIL = 2;
const OTHER_TAIL = 5;

/**
 * 工具名称（如 create_file、read_file 等）转换为小写并匹配特征后缀
 */
function tailLinesFor(name: string): number {
  const lower = name.toLowerCase();
  // read/search/list 等只读操作通常输出较少，展示 2 行即可
  // create/write/edit 等写入操作输出可能较长，展示 5 行更合适
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

/**
 * 确定工具的最终显示状态，优先级: running > rejected > aborted > exitCode !== 0 > ok
 */
function toolStatus(card: ToolCardData, isInflight: boolean): ToolStatus {
  if (isInflight) return 'running';
  if (card.rejected) return 'rejected';
  if (card.aborted) return 'aborted';
  if (card.exitCode !== undefined && card.exitCode !== 0) return 'error';
  return 'ok';
}

/**
 * 根据工具调用状态返回对应的显示图标
 * running: ●   ok: ✓   rejected/error: ✗   aborted: ⊘
 */
function statusGlyph(s: ToolStatus): string {
  switch (s) { case 'running': return '\u25CF'; case 'ok': return '\u2713'; case 'rejected': case 'error': return '\u2717'; case 'aborted': return '\u2298'; }
}

function headerColorFor(s: ToolStatus): string {
  switch (s) { case 'ok': return TONE.ok; case 'rejected': case 'error': case 'aborted': return TONE.err; case 'running': return TONE.brand; }
}

/**
 * 格式化工具调用的参数摘要
 * - 字符串参数：截断至 60 字符
 * - 对象参数：取第一个字段的值作为摘要，多余字段用 "+N" 标记
 * - 空对象返回空字符串
 */
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

/**
 * 根据指定的尾部行数选取输出预览行，超出时仅截取最后几行
 */
function selectPreviewLines(output: string, tailLines: number): string[] {
  if (!output) return [];
  const lines = output.split('\n');
  if (lines.length <= tailLines) return lines;
  return lines.slice(-tailLines);
}

export function ToolCard({ card, isInflight = false }: { card: ToolCardData; isInflight?: boolean }): React.ReactElement {
  const cols = process.stdout.columns ?? 80;
  const lineCells = Math.max(20, cols - 4); // 每行可用字符数，不低于 20
  const argsLabel = formatArgsSummary(card.args);
  const status = toolStatus(card, isInflight);
  const headColor = headerColorFor(status);
  const tail = tailLinesFor(card.name);
  const preview = selectPreviewLines(card.output, tail);
  const showBody = !card.rejected && preview.length > 0; // 拒绝的工具不展示输出内容

  const meta: MetaItem[] = [];
  if (card.rejected) meta.push({ text: t().rejected, color: TONE.err });
  if (card.elapsedMs && card.elapsedMs > 0) meta.push(`${(card.elapsedMs / 1000).toFixed(2)}s`);
  if (card.done && !card.rejected && !card.aborted && card.exitCode !== undefined && card.exitCode !== 0) {
    meta.push({ text: t().exitCode(card.exitCode), color: TONE.err });
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
