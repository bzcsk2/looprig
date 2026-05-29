import { Component } from "../tui";
import { visibleWidth } from "../utils";

export class DiffPreview implements Component {
  #oldLines: string[] = []; #newLines: string[] = [];
  #maxLines = 20;

  setDiff(oldContent: string, newContent: string): void {
    this.#oldLines = oldContent.split("\n");
    this.#newLines = newContent.split("\n");
  }
  clear(): void { this.#oldLines = []; this.#newLines = []; }
  invalidate(): void {}

  render(width: number): string[] {
    if (this.#oldLines.length === 0 && this.#newLines.length === 0) return [];
    const lines: string[] = [];
    lines.push("\x1b[1mdiff:\x1b[0m");
    const max = Math.max(this.#oldLines.length, this.#newLines.length);
    const shown = Math.min(max, this.#maxLines);
    for (let i = 0; i < shown; i++) {
      const oldL = i < this.#oldLines.length ? this.#oldLines[i] : undefined;
      const newL = i < this.#newLines.length ? this.#newLines[i] : undefined;
      if (oldL === newL) continue;
      if (oldL !== undefined && newL === undefined) { lines.push(`\x1b[31m- ${slice(oldL, width - 4)}\x1b[0m`); continue; }
      if (oldL === undefined && newL !== undefined) { lines.push(`\x1b[32m+ ${slice(newL, width - 4)}\x1b[0m`); continue; }
      if (oldL !== newL) {
        lines.push(`\x1b[31m- ${slice(oldL!, width - 4)}\x1b[0m`);
        lines.push(`\x1b[32m+ ${slice(newL!, width - 4)}\x1b[0m`);
      }
    }
    if (max > this.#maxLines) lines.push(`  \x1b[90m... ${max - this.#maxLines} more lines\x1b[0m`);
    return lines;
  }
}

function slice(s: string, w: number): string { return visibleWidth(s) > w ? s.slice(0, Math.max(0, w - 3)) + "..." : s; }
