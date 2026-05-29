import { marked } from "marked";
import type { Token, Tokens } from "marked";
import { Component } from "../tui";
import { wrapTextWithAnsi, padding, visibleWidth, truncateToWidth } from "../utils";

export interface MarkdownTheme {
  heading?: (text: string, level: number) => string;
  bold?: (text: string) => string;
  italic?: (text: string) => string;
  code?: (text: string) => string;
  codeBlock?: (text: string) => string;
  link?: (text: string, url: string) => string;
  blockquote?: (text: string) => string;
  listItem?: (text: string, prefix: string) => string;
  hr?: string;
  strikethrough?: (text: string) => string;
}

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const STRIKE = "\x1b[9m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";
const BG_DARK = "\x1b[48;5;236m";

function defaultTheme(): Required<MarkdownTheme> {
  return {
    heading: (text, level) => `${BOLD}${level <= 2 ? YELLOW : CYAN}${text}${RESET}`,
    bold: text => `${BOLD}${text}${RESET}`,
    italic: text => `${ITALIC}${text}${RESET}`,
    code: text => `${YELLOW}${text}${RESET}`,
    codeBlock: text => `${BG_DARK}${text}${RESET}`,
    link: (text, url) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`,
    blockquote: text => `${GRAY}│ ${text}${RESET}`,
    listItem: (text, prefix) => `${prefix} ${text}`,
    hr: `${GRAY}${"─".repeat(40)}${RESET}`,
    strikethrough: text => `${STRIKE}${text}${RESET}`,
  };
}

export class Markdown implements Component {
  #text: string;
  #paddingX: number;
  #paddingY: number;
  #theme: Required<MarkdownTheme>;
  #cache: Map<string, string[]> = new Map();

  constructor(
    text: string,
    paddingX = 1,
    paddingY = 1,
    theme?: MarkdownTheme,
  ) {
    this.#text = text;
    this.#paddingX = paddingX;
    this.#paddingY = paddingY;
    this.#theme = { ...defaultTheme(), ...theme };
  }

  invalidate(): void {
    this.#cache.clear();
  }

  render(width: number): string[] {
    const innerW = Math.max(1, width - this.#paddingX * 2);
    const key = `${this.#text}:${width}`;
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const tokens = marked.lexer(this.#text);
    const rendered = this.#renderTokens(tokens, innerW);

    const result: string[] = [];
    for (let i = 0; i < this.#paddingY; i++) result.push("");
    for (const line of rendered) {
      result.push(padding(this.#paddingX) + line);
    }
    for (let i = 0; i < this.#paddingY; i++) result.push("");

    if (this.#cache.size >= 50) { const first = this.#cache.keys().next().value; if (first !== undefined) this.#cache.delete(first); }
    this.#cache.set(key, result);
    return result;
  }

  #renderTokens(tokens: Token[], width: number): string[] {
    const lines: string[] = [];
    for (const token of tokens) {
      lines.push(...this.#renderBlockToken(token, width));
    }
    return lines;
  }

  #renderBlockToken(token: Token, width: number): string[] {
    switch (token.type) {
      case "paragraph": {
        const t = token as Tokens.Paragraph;
        const text = this.#renderInlineTokens(t.tokens);
        return wrapTextWithAnsi(text, width);
      }
      case "heading": {
        const t = token as Tokens.Heading;
        const text = this.#renderInlineTokens(t.tokens);
        return [this.#theme.heading(truncateToWidth(text, width), t.depth)];
      }
      case "code": {
        const t = token as Tokens.Code;
        const codeLines = t.text.split("\n");
        return codeLines.map(l => this.#theme.codeBlock(l));
      }
      case "blockquote": {
        const t = token as Tokens.Blockquote;
        const inner = this.#renderTokens(t.tokens, Math.max(1, width - 2));
        return inner.map(l => this.#theme.blockquote(l));
      }
      case "list": {
        const t = token as Tokens.List;
        return this.#renderList(t, width);
      }
      case "table": {
        return this.#renderTable(token as Tokens.Table, width);
      }
      case "hr":
        return [this.#theme.hr];
      case "space":
        return [""];
      default:
        return [];
    }
  }

  #renderList(list: Tokens.List, width: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < list.items.length; i++) {
      const item = list.items[i]!;
      const prefix = list.ordered ? `${i + 1}.` : "•";
      const itemWidth = Math.max(1, width - visibleWidth(prefix) - 1);
      const lines = this.#renderTokenLines(item, itemWidth);
      if (lines.length > 0) {
        result.push(this.#theme.listItem(lines[0]!, prefix));
        for (let j = 1; j < lines.length; j++) {
          result.push(padding(visibleWidth(prefix) + 1) + lines[j]!);
        }
      } else {
        result.push(this.#theme.listItem("", prefix));
      }
    }
    return result;
  }

  #renderTokenLines(token: Token, width: number): string[] {
    if (token.type === "list_item") {
      const t = token as Tokens.ListItem;
      const lines: string[] = [];
      for (const child of t.tokens) {
        lines.push(...this.#renderBlockToken(child, width));
      }
      return lines;
    }
    return this.#renderBlockToken(token, width);
  }

  #renderInlineTokens(tokens?: Token[]): string {
    if (!tokens) return "";
    let result = "";
    for (const token of tokens) {
      result += this.#renderInlineToken(token);
    }
    return result;
  }

  #renderInlineToken(token: Token): string {
    switch (token.type) {
      case "text":
        return (token as Tokens.Text).text;
      case "strong":
        return this.#theme.bold(this.#renderInlineTokens((token as Tokens.Strong).tokens));
      case "em":
        return this.#theme.italic(this.#renderInlineTokens((token as Tokens.Em).tokens));
      case "codespan":
        return this.#theme.code((token as Tokens.Codespan).text);
      case "link":
        return this.#theme.link(
          this.#renderInlineTokens((token as Tokens.Link).tokens),
          (token as Tokens.Link).href,
        );
      case "br":
        return "\n";
      case "del":
        return this.#theme.strikethrough(this.#renderInlineTokens((token as Tokens.Del).tokens));
      default:
        return "";
    }
  }

  #renderTable(table: Tokens.Table, width: number): string[] {
    const result: string[] = [];
    const colCount = table.header.length;
    if (colCount === 0) return result;
    const colWidth = Math.max(3, Math.floor(width / colCount));

    const headerCells = table.header.map(h =>
      truncateToWidth(this.#renderInlineTokens(h.tokens), colWidth - 1),
    );
    result.push(`${BOLD}${headerCells.join(" ")}${RESET}`);
    result.push(GRAY + "─".repeat(width) + RESET);

    for (const row of table.rows) {
      const cells = row.map(c =>
        truncateToWidth(this.#renderInlineTokens(c.tokens), colWidth - 1),
      );
      result.push(cells.join(" "));
    }

    return result;
  }
}
