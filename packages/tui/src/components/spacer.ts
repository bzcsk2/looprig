import { Component, TUI } from "../tui";

export class Spacer implements Component {
  #lines: number;

  constructor(lines = 1) {
    this.#lines = lines;
  }

  invalidate(): void {}

  render(_width: number): string[] {
    return Array<string>(this.#lines).fill("");
  }
}

/** 填充底部剩余空间，将后续内容推到终端底部 */
export class FillSpacer implements Component {
  #tui: TUI;
  #reserved: number;

  constructor(tui: TUI, reservedLinesBelow: number) {
    this.#tui = tui;
    this.#reserved = reservedLinesBelow;
  }

  invalidate(): void {}

  render(width: number): string[] {
    // calculate how many lines all other children occupy
    let otherLines = 0;
    for (const c of this.#tui.children) {
      if (c === this) continue;
      otherLines += c.render(width).length;
    }
    const gap = Math.max(0, this.#tui.terminal.rows - otherLines - this.#reserved);
    return Array<string>(gap).fill("");
  }
}
