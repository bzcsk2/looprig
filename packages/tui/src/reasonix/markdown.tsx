/**
 * Markdown → Ink 渲染器（基于 react-ink）
 *
 * 本模块负责将 Markdown 文本解析为 AST（抽象语法树），
 * 并通过 Ink 组件树逐层渲染为终端兼容的输出。
 * 支持标题、段落、列表（有序/无序/任务）、代码块（含语法高亮）、
 * 引用块、水平线、表格、内联样式（粗体/斜体/删除线/链接/图片/行内代码等）。
 * 颜色和样式通过 tokens.ts 中的语义化 Token 统一管理。
 */

import { highlight, supportsLanguage } from 'cli-highlight';
import { Box, Text } from '@deepicode/ink';
import { type Token, type Tokens, marked } from 'marked';
import React from 'react';
import stringWidth from 'string-width';
import { decodeHtmlEntities } from './html-entities.js';
import { padToCells, wrapToCells } from './text-width.js';
import { FG, SURFACE, TONE } from './tokens.js';

/** 正文左侧边距（列数），用于内容缩进 */
const BODY_LEFT_CELLS = 7;

/** 获取终端可用宽度（扣除左侧边距后的列数） */
function useWidth(): number {
  return (process.stdout.columns ?? 80) - BODY_LEFT_CELLS;
}

/** 启用 GFM（GitHub Flavored Markdown）语法，关闭硬换行 */
marked.setOptions({ gfm: true, breaks: false });

/**
 * Markdown 渲染入口组件
 * @param text - 原始 Markdown 文本
 * @param width - （可选）渲染宽度，不传则自动检测终端宽度
 */
export function Markdown({ text, width }: { text: string; width?: number }): React.ReactElement {
  const tokens = React.useMemo(() => marked.lexer(text), [text]);
  return (
    <Box flexDirection="column" gap={1}>
      {tokens.map((token, i) => (
        <BlockToken key={`${i}-${token.type}`} token={token} />
      ))}
    </Box>
  );
}

/**
 * 块级 Token 分发组件
 * 根据 token.type 将不同块级元素路由到对应的渲染组件
 * @param token - marked 解析生成的块级 Token
 */
function BlockToken({ token }: { token: Token }): React.ReactElement | null {
  switch (token.type) {
    case 'heading': return <Heading token={token as Tokens.Heading} />;
    case 'paragraph': return <Paragraph token={token as Tokens.Paragraph} />;
    case 'list': return <List token={token as Tokens.List} depth={0} />;
    case 'code': return <CodeBlock token={token as Tokens.Code} />;
    case 'blockquote': return <Blockquote token={token as Tokens.Blockquote} />;
    case 'hr': return <HorizontalRule />;
    case 'table': return <Table token={token as Tokens.Table} />;
    case 'html': return <Text color={FG.body}>{(token as Tokens.HTML).text}</Text>;
    case 'space': return null;
    default: return <Text color={FG.body}>{(token as { raw?: string }).raw ?? ''}</Text>;
  }
}

/**
 * 标题渲染组件
 * 使用粗体 + 强对照色，带背景色标签效果
 * @param token.depth - 标题层级（1~6）
 */
function Heading({ token }: { token: Tokens.Heading }): React.ReactElement {
  return (
    <Box>
      <Text bold color={FG.strong} backgroundColor={SURFACE.bgElev}>
        {` ${plainText(token.tokens)} `}
      </Text>
    </Box>
  );
}

/**
 * 段落渲染组件
 * 使用正文色包裹内联 Token
 */
function Paragraph({ token }: { token: Tokens.Paragraph }): React.ReactElement {
  return <Text color={FG.body}><Inline tokens={token.tokens ?? []} /></Text>;
}

/**
 * 列表渲染组件
 * 支持有序列表、无序列表和任务列表（带递归嵌套）
 * @param depth - 嵌套深度，用于控制缩进
 */
function List({ token, depth }: { token: Tokens.List; depth: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {token.items.map((item, i) => (
        <ListItem key={`${i}-${item.text.slice(0, 24)}`} item={item} ordered={token.ordered} index={i + (Number(token.start) || 1)} depth={depth} />
      ))}
    </Box>
  );
}

/**
 * 列表项渲染组件
 * 根据有序/无序/任务类型选择标记符号（✓ 已完成 / ○ 未完成 / 数字 / 圆点）
 * 已完成的任务项以浅色 + 删除线显示
 * @param ordered - 是否为有序列表
 * @param index - 列表项序号
 * @param depth - 嵌套深度
 */
function ListItem({ item, ordered, index, depth }: { item: Tokens.ListItem; ordered: boolean; index: number; depth: number }): React.ReactElement {
  // 选择列表标记符号：任务完成 ✓ / 任务未完成 ○ / 有序数字 / 无序圆点 ·
  const marker = item.task ? (item.checked ? '\u2713' : '\u25CB') : ordered ? `${index}.` : '\u00B7';
  const markerColor = item.task ? (item.checked ? TONE.ok : FG.faint) : FG.meta;
  const dim = item.task && item.checked === true; // 已完成任务文本使用浅色 + 删除线
  const indent = ' '.repeat(depth + 1);
  return (
    <Box>
      <Text color={markerColor}>{`${indent}${marker} `}</Text>
      <Box flexDirection="column">
        {item.tokens.map((tok, i) => {
          if (tok.type === 'text') {
            const inner = (tok as Tokens.Text).tokens;
            return <Text key={`t-${i}`} color={dim ? FG.faint : FG.body} strikethrough={dim}>{inner ? <Inline tokens={inner} /> : (tok as Tokens.Text).text}</Text>;
          }
          if (tok.type === 'list') return <List key={`l-${i}`} token={tok as Tokens.List} depth={depth + 1} />;
          return <BlockToken key={`b-${i}-${tok.type}`} token={tok} />;
        })}
      </Box>
    </Box>
  );
}

/**
 * 代码块渲染组件
 * 使用 cli-highlight 进行语法高亮，支持多语言
 * 顶部显示语言标签，代码行带背景色以区分正文
 */
function CodeBlock({ token }: { token: Tokens.Code }): React.ReactElement {
  const lang = token.lang?.split(/\s+/)[0] ?? '';
  const colored = highlightCode(decodeHtmlEntities(token.text), lang);
  const lines = colored.split('\n');
  return (
    <Box flexDirection="column">
      {lang ? <Box><Text color={FG.meta}>{` ${lang}`}</Text></Box> : null}
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={`code-${i}`} backgroundColor={SURFACE.bgElev}>{` ${line} `}</Text>
        ))}
      </Box>
    </Box>
  );
}

/**
 * 代码语法高亮辅助函数
 * @param source - 原始代码文本
 * @param lang - 编程语言标识（如 "js"、"python"），为空则不染色
 * @returns 带 ANSI 颜色码的文本
 * @sideEffect 调用 cli-highlight 进行语法分析
 */
function highlightCode(source: string, lang: string): string {
  if (!lang) return source;
  try {
    if (supportsLanguage(lang)) return highlight(source, { language: lang, ignoreIllegals: true });
    return highlight(source, { ignoreIllegals: true });
  } catch { return source; }
}

/**
 * 引用块渲染组件
 * 左侧显示品牌色竖条（▎），内容以斜体 + 次要色显示
 * 引用内可包含段落及其他块级元素
 */
function Blockquote({ token }: { token: Tokens.Blockquote }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {(token.tokens ?? []).map((child, i) => (
        <Box key={`${i}-${child.type}`} flexDirection="row">
          <Text color={TONE.brand}>{' \u258E '}</Text>
          <Box flexDirection="column" flexGrow={1}>
            {child.type === 'paragraph' ? (
              <Text italic color={FG.sub}><Inline tokens={(child as Tokens.Paragraph).tokens ?? []} /></Text>
            ) : <BlockToken token={child} />}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/**
 * 水平分割线渲染组件
 * 使用浅色重复横线（┄）占满终端宽度
 */
function HorizontalRule(): React.ReactElement {
  const width = useWidth();
  return <Text color={FG.faint}>{` ${'\u2500'.repeat(Math.max(width, 1))}`}</Text>;
}

/**
 * 表格渲染组件
 * 两种渲染模式：
 * 1. 标准模式（总宽 ≤ 终端宽度）：网格对齐，带表头分隔线
 * 2. 回退模式（表格过宽）：转成 key: value 纵向排列，自动换行
 */
function Table({ token }: { token: Tokens.Table }): React.ReactElement {
  const width = useWidth();
  const headerCells = token.header.map(c => plainText(c.tokens));
  const bodyCells = token.rows.map(row => row.map(c => plainText(c.tokens)));
  const colCount = headerCells.length;
  const GAP = ' ';
  const GAP_W = stringWidth(GAP);
  const widths = new Array<number>(colCount).fill(0);
  for (let c = 0; c < colCount; c++) {
    widths[c] = Math.max(stringWidth(headerCells[c] ?? ''), ...bodyCells.map(r => stringWidth(r[c] ?? '')));
  }
  const totalWidth = widths.reduce((s, w) => s + w, 0) + GAP_W * (colCount - 1);
  if (totalWidth <= width) {
    const ruleRow = widths.map(w => '\u2500'.repeat(w)).join(GAP);
    return (
      <Box flexDirection="column">
        <Box><Text> </Text>{headerCells.map((cell, i) => (
          <React.Fragment key={`h-${i}`}>
            <Text bold color={FG.sub}>{padToCells(cell, widths[i]!)}</Text>
            {i < colCount - 1 ? <Text>{GAP}</Text> : null}
          </React.Fragment>
        ))}</Box>
        <Box><Text> </Text><Text color={FG.faint}>{ruleRow}</Text></Box>
        {bodyCells.map((row, ri) => (
          <Box key={`tr-${ri}`}><Text> </Text>{row.map((cell, i) => (
            <React.Fragment key={`c-${ri}-${i}`}>
              <Text color={FG.body}>{padToCells(cell ?? '', widths[i]!)}</Text>
              {i < colCount - 1 ? <Text>{GAP}</Text> : null}
            </React.Fragment>
          ))}</Box>
        ))}
      </Box>
    );
  }
  // 回退模式：当表格总宽超过终端可用宽度时，转为 key: value 纵向排列
  const labelPad = Math.min(Math.max(...headerCells.map(h => stringWidth(h))) + 2, width - 1);
  const valueCells = width - labelPad;
  return (
    <Box flexDirection="column">
      {bodyCells.map((row, ri) => (
        <Box key={`fr-${ri}`} flexDirection="column">
          {ri > 0 ? <Text> </Text> : null}
          {headerCells.map((h, ci) => {
            const label = `${padToCells(h, labelPad - 2)}: `;
            const lines = wrapToCells(row[ci] ?? '', valueCells);
            return lines.map((line, li) => (
              <Box key={`fc-${ri}-${ci}-${li}`}>
                {li === 0 ? <Text bold color={FG.sub}>{label}</Text> : <Text>{padToCells('', labelPad)}</Text>}
                <Text color={FG.body}>{line}</Text>
              </Box>
            ));
          })}
        </Box>
      ))}
    </Box>
  );
}

/**
 * 内联 Token 容器组件
 * 遍历 tokens 数组，将每个内联 Token 交由 InlineToken 渲染
 */
function Inline({ tokens }: { tokens: Token[] }): React.ReactElement {
  return <>{tokens.map((tok, i) => <InlineToken key={`${i}-${tok.type}`} token={tok} />)}</>;
}

/**
 * 内联 Token 分发渲染组件
 * 处理粗体、斜体、行内代码、删除线、链接、图片、换行、HTML 等内联样式
 * 各样式使用 tokens.ts 中的语义颜色
 */
function InlineToken({ token }: { token: Token }): React.ReactElement {
  switch (token.type) {
    case 'text': { const t = token as Tokens.Text; return t.tokens ? <Inline tokens={t.tokens} /> : <Text>{t.text}</Text>; }
    case 'strong': return <Text bold color={FG.strong}><Inline tokens={(token as Tokens.Strong).tokens} /></Text>;
    case 'em': return <Text italic><Inline tokens={(token as Tokens.Em).tokens} /></Text>;
    case 'codespan': return <Text color={FG.strong} backgroundColor={SURFACE.bgElev}>{` ${decodeHtmlEntities((token as Tokens.Codespan).text)} `}</Text>;
    case 'del': return <Text color={TONE.err} strikethrough><Inline tokens={(token as Tokens.Del).tokens} /></Text>;
    case 'link': { const l = token as Tokens.Link; return <Text color={TONE.brand} underline><Inline tokens={l.tokens} /></Text>; }
    case 'image': return <Text color={TONE.brand}>{`[image: ${(token as Tokens.Image).text || (token as Tokens.Image).href}]`}</Text>;
    case 'br': return <Text>{'\n'}</Text>;
    case 'escape': return <Text>{(token as Tokens.Escape).text}</Text>;
    case 'html': return <Text>{(token as Tokens.HTML).text}</Text>;
    default: return <Text>{(token as { raw?: string }).raw ?? ''}</Text>;
  }
}

/**
 * 从 Token 数组中提取纯文本（去除所有样式标记）
 * 用于表格列宽计算、列表项 key 生成等需要纯文本长度的场景
 * @param tokens - marked 解析的 Token 数组
 * @returns 拼接后的纯文本字符串
 */
export function plainText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'text': out += (t as Tokens.Text).text; break;
      case 'strong': case 'em': case 'del': case 'link': out += plainText((t as { tokens?: Token[] }).tokens ?? []); break;
      case 'codespan': out += decodeHtmlEntities((t as Tokens.Codespan).text); break;
      case 'br': out += '\n'; break;
      case 'escape': out += (t as Tokens.Escape).text; break;
      default: out += (t as { raw?: string }).raw ?? '';
    }
  }
  return out;
}
