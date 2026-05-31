/** Markdown → Ink renderer. Adapted from Reasonix for deepicode. */

import { highlight, supportsLanguage } from 'cli-highlight';
import { Box, Text } from '@deepicode/ink';
import { type Token, type Tokens, marked } from 'marked';
import React from 'react';
import stringWidth from 'string-width';
import { decodeHtmlEntities } from './html-entities.js';
import { padToCells, wrapToCells } from './text-width.js';
import { FG, SURFACE, TONE } from './tokens.js';

const BODY_LEFT_CELLS = 7;

function useWidth(): number {
  return (process.stdout.columns ?? 80) - BODY_LEFT_CELLS;
}

marked.setOptions({ gfm: true, breaks: false });

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

function Heading({ token }: { token: Tokens.Heading }): React.ReactElement {
  return (
    <Box>
      <Text bold color={FG.strong} backgroundColor={SURFACE.bgElev}>
        {` ${plainText(token.tokens)} `}
      </Text>
    </Box>
  );
}

function Paragraph({ token }: { token: Tokens.Paragraph }): React.ReactElement {
  return <Text color={FG.body}><Inline tokens={token.tokens ?? []} /></Text>;
}

function List({ token, depth }: { token: Tokens.List; depth: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {token.items.map((item, i) => (
        <ListItem key={`${i}-${item.text.slice(0, 24)}`} item={item} ordered={token.ordered} index={i + (Number(token.start) || 1)} depth={depth} />
      ))}
    </Box>
  );
}

function ListItem({ item, ordered, index, depth }: { item: Tokens.ListItem; ordered: boolean; index: number; depth: number }): React.ReactElement {
  const marker = item.task ? (item.checked ? '\u2713' : '\u25CB') : ordered ? `${index}.` : '\u00B7';
  const markerColor = item.task ? (item.checked ? TONE.ok : FG.faint) : FG.meta;
  const dim = item.task && item.checked === true;
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

function highlightCode(source: string, lang: string): string {
  if (!lang) return source;
  try {
    if (supportsLanguage(lang)) return highlight(source, { language: lang, ignoreIllegals: true });
    return highlight(source, { ignoreIllegals: true });
  } catch { return source; }
}

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

function HorizontalRule(): React.ReactElement {
  const width = useWidth();
  return <Text color={FG.faint}>{` ${'\u2500'.repeat(Math.max(width, 1))}`}</Text>;
}

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
  // Fallback: key/value
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

function Inline({ tokens }: { tokens: Token[] }): React.ReactElement {
  return <>{tokens.map((tok, i) => <InlineToken key={`${i}-${tok.type}`} token={tok} />)}</>;
}

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
