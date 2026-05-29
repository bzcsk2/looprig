const SEGMENT_RESET = "\x1b[0m";
const LINE_TERMINATOR = "\x1b[0m\x1b]8;;\x07";
export const CURSOR_MARKER = "\x1b_pi:c\x07";

export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
export interface Focusable { focused: boolean; }
export function isFocusable(c: Component | null): c is Component & Focusable { return c !== null && "focused" in c; }
export { visibleWidth } from "./utils";

export class Container implements Component {
  children: Component[] = [];
  addChild(c: Component): void { this.children.push(c); }
  removeChild(c: Component): void { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
  clear(): void { this.children = []; }
  invalidate(): void { for (const c of this.children) c.invalidate?.(); }
  render(width: number): string[] {
    width = Math.max(1, width); const lines: string[] = [];
    for (const c of this.children) lines.push(...c.render(width));
    return lines;
  }
}

export type OverlayAnchor = "center"|"top-left"|"top-right"|"bottom-left"|"bottom-right"|"top-center"|"bottom-center"|"left-center"|"right-center";
export type SizeValue = number | `${number}%`;
export interface OverlayOptions {
  width?: SizeValue; minWidth?: number; maxHeight?: SizeValue;
  anchor?: OverlayAnchor; offsetX?: number; offsetY?: number;
  row?: SizeValue; col?: SizeValue;
  margin?: { top?: number; right?: number; bottom?: number; left?: number } | number;
  visible?: (w: number, h: number) => boolean;
}
export interface OverlayHandle { hide(): void; setHidden(h: boolean): void; isHidden(): boolean; }

export class TUI extends Container {
  terminal: import("./terminal").Terminal;
  #prevLines: string[] = []; #prevW = 0; #prevH = 0;
  #focused: Component | null = null; #inputListeners = new Set<(d: string) => { consume?: boolean; data?: string } | undefined>();
  onDebug?: () => void;
  #renderReq = false; #renderTimer?: ReturnType<typeof setTimeout>; #lastRenderAt = 0;
  #cursorRow = 0; #hwCursorRow = 0; #maxLines = 0; #hasRendered = false; #stopped = false;
  #showHWCursor = false;
  overlayStack: { component: Component; options?: OverlayOptions; preFocus: Component | null; hidden: boolean }[] = [];

  constructor(t: import("./terminal").Terminal, hwCursor?: boolean) { super(); this.terminal = t; if (hwCursor !== undefined) this.#showHWCursor = hwCursor; }

  get fullRedraws(): number { return 0; }
  setFocus(c: Component | null): void { if (isFocusable(this.#focused)) this.#focused.focused = false; this.#focused = c; if (isFocusable(c)) c.focused = true; }

  showOverlay(c: Component, opts?: OverlayOptions): OverlayHandle {
    const entry = { component: c, options: opts, preFocus: this.#focused, hidden: false };
    this.overlayStack.push(entry);
    this.setFocus(c); this.terminal.hideCursor(); this.requestRender();
    return {
      hide: () => { const i = this.overlayStack.indexOf(entry); if (i >= 0) { this.overlayStack.splice(i, 1); if (this.#focused === c) this.setFocus(entry.preFocus); if (this.overlayStack.length === 0) this.terminal.hideCursor(); this.requestRender(); } },
      setHidden: (h: boolean) => { if (entry.hidden !== h) { entry.hidden = h; this.requestRender(); } },
      isHidden: () => entry.hidden,
    };
  }
  hideOverlay(): void { const o = this.overlayStack.pop(); if (o) { this.setFocus(o.preFocus); if (this.overlayStack.length === 0) this.terminal.hideCursor(); this.requestRender(); } }
  hasOverlay(): boolean { return this.overlayStack.length > 0; }

  override invalidate(): void { super.invalidate(); for (const o of this.overlayStack) o.component.invalidate?.(); }

  start(): void {
    this.#stopped = false;
    this.terminal.start(d => this.#handleInput(d), () => this.requestRender());
    this.terminal.hideCursor();
    this.requestRender(true);
  }
  addInputListener(fn: (d: string) => { consume?: boolean; data?: string } | undefined): () => void { this.#inputListeners.add(fn); return () => this.#inputListeners.delete(fn); }

  stop(): void {
    this.#stopped = true; if (this.#renderTimer) { clearTimeout(this.#renderTimer); this.#renderTimer = undefined; }
    if (this.#prevLines.length > 0) {
      const target = this.#prevLines.length; const diff = target - this.#hwCursorRow;
      if (diff > 0) this.terminal.write(`\x1b[${diff}B`); else if (diff < 0) this.terminal.write(`\x1b[${-diff}A`);
      this.terminal.write("\r\n");
    }
    this.terminal.showCursor(); this.terminal.stop();
  }

  requestRender(force = false): void {
    if (force) {
      this.#prevLines = []; this.#prevW = -1; this.#prevH = -1; this.#cursorRow = 0; this.#hwCursorRow = 0; this.#maxLines = 0;
      if (this.#renderTimer) { clearTimeout(this.#renderTimer); this.#renderTimer = undefined; }
      this.#renderReq = true; process.nextTick(() => { if (this.#stopped || !this.#renderReq) return; this.#renderReq = false; this.#lastRenderAt = performance.now(); this.#doRender(); });
      return;
    }
    if (this.#renderReq) return; this.#renderReq = true;
    process.nextTick(() => {
      if (this.#stopped || this.#renderTimer || !this.#renderReq) return;
      const elapsed = performance.now() - this.#lastRenderAt; const delay = Math.max(0, 16 - elapsed);
      this.#renderTimer = setTimeout(() => { this.#renderTimer = undefined; if (this.#stopped || !this.#renderReq) return; this.#renderReq = false; this.#lastRenderAt = performance.now(); this.#doRender(); }, delay);
    });
  }

  #handleInput(data: string): void {
    let cur = data;
    for (const fn of this.#inputListeners) { const r = fn(cur); if (r?.consume) return; if (r?.data !== undefined) cur = r.data; }
    if (cur.length === 0) return; data = cur;
    if (this.#focused?.handleInput) { this.#focused.handleInput(data); this.requestRender(); }
  }

  #doRender(): void {
    if (this.#stopped) return;
    const w = this.terminal.columns, h = this.terminal.rows;
    let lines = this.render(w);
    if (this.overlayStack.length > 0) lines = this.#compositeOverlays(lines, w, h);
    lines = lines.map(l => l + (l.includes("\x1b]8;") ? LINE_TERMINATOR : SEGMENT_RESET));
    const wChanged = this.#prevW > 0 && this.#prevW !== w;
    const hChanged = this.#prevH > 0 && this.#prevH !== h;

    if (!this.#hasRendered) {
      this.#emitFull(lines, w, h); this.#hasRendered = true; return;
    }
    if (this.#prevLines.length === 0) { this.#emitViewport(lines, w, h); return; }

    const diff = this.#diffLines(lines);
    if (diff.firstChanged === -1) {
      if (wChanged || hChanged) { this.#emitViewport(lines, w, h); return; }
      this.#commit(lines, w, h, Math.max(0, this.#maxLines - h), this.#hwCursorRow); return;
    }
    if (diff.firstChanged >= lines.length) { this.#emitShrink(lines, w, h); return; }
    const contentGrew = lines.length > this.#prevLines.length;
    if (wChanged || hChanged || diff.firstChanged < Math.max(0, this.#prevLines.length - h)) {
      this.#emitViewport(lines, w, h); return;
    }
    this.#emitDiff(lines, w, h, diff.firstChanged, diff.lastChanged, contentGrew);
  }

  #diffLines(newLines: string[]): { firstChanged: number; lastChanged: number; appendedLines: boolean } {
    let fc = -1, lc = -1;
    const max = Math.max(newLines.length, this.#prevLines.length);
    for (let i = 0; i < max; i++) {
      const o = i < this.#prevLines.length ? this.#prevLines[i] : "";
      const n = i < newLines.length ? newLines[i] : "";
      if (o !== n) { if (fc === -1) fc = i; lc = i; }
    }
    const appended = newLines.length > this.#prevLines.length;
    if (appended && fc === -1) { fc = this.#prevLines.length; lc = newLines.length - 1; }
    return { firstChanged: fc, lastChanged: lc, appendedLines: appended };
  }

  #emitFull(lines: string[], w: number, h: number): void {
    let buf = "\x1b[?2026h\x1b[2J\x1b[H";
    for (let i = 0; i < lines.length; i++) { if (i > 0) buf += "\r\n"; buf += lines[i]; }
    buf += "\x1b[?2026l"; this.terminal.write(buf);
    this.#maxLines = lines.length; this.#commit(lines, w, h, Math.max(0, lines.length - h), Math.max(0, lines.length - 1));
  }

  #emitViewport(lines: string[], w: number, h: number): void {
    const vt = Math.max(0, lines.length - h);
    let buf = "\x1b[?2026h\x1b[H";
    for (let r = 0; r < h; r++) { if (r > 0) buf += "\r\n"; buf += "\x1b[2K"; const l = lines[vt + r]; if (l) buf += l; }
    buf += "\x1b[?2026l"; this.terminal.write(buf);
    this.#maxLines = lines.length; this.#commit(lines, w, h, vt, Math.max(0, lines.length - 1));
  }

  #emitShrink(lines: string[], w: number, h: number): void {
    const extra = this.#prevLines.length - lines.length;
    if (extra > h) { this.#emitViewport(lines, w, h); return; }
    let buf = "\x1b[?2026h";
    const vt = Math.max(0, this.#maxLines - h);
    const tr = Math.max(0, lines.length - 1);
    const curSr = this.#hwCursorRow - Math.max(0, this.#prevLines.length - h);
    const tgtSr = tr - vt;
    const d = tgtSr - curSr;
    if (d > 0) buf += `\x1b[${d}B`; else if (d < 0) buf += `\x1b[${-d}A`;
    buf += "\r";
    for (let i = 0; i < extra; i++) { buf += "\r\x1b[2K"; if (i < extra - 1) buf += "\x1b[1B"; }
    buf += "\x1b[?2026l"; this.terminal.write(buf);
    this.#maxLines = lines.length; this.#commit(lines, w, h, Math.max(0, lines.length - h), tr);
  }

  #emitDiff(lines: string[], w: number, h: number, fc: number, lc: number, appended: boolean): void {
    const vt = Math.max(0, lines.length - h);
    const startRow = Math.max(0, fc - vt);
    const endRow = Math.min(h - 1, lc - vt);
    let buf = "\x1b[?2026h";
    if (startRow > 0) buf += `\x1b[${startRow}B`;
    for (let r = startRow; r <= endRow; r++) {
      buf += "\r\x1b[2K"; const l = lines[vt + r]; if (l) buf += l;
      if (r < endRow) buf += `\x1b[1B`;
    }
    if (appended && endRow < h - 1) { const rem = h - 1 - endRow; buf += `\x1b[${rem}B`; }
    buf += "\x1b[?2026l"; this.terminal.write(buf);
    this.#maxLines = lines.length; this.#commit(lines, w, h, vt, Math.max(0, lines.length - 1));
  }

  #commit(lines: string[], w: number, h: number, vt: number, hwRow: number): void {
    this.#prevLines = lines; this.#prevW = w; this.#prevH = h; this.#cursorRow = Math.max(0, lines.length - 1); this.#hwCursorRow = Math.max(0, hwRow);
  }

  #compositeOverlays(lines: string[], tw: number, th: number): string[] {
    const r = [...lines]; let minH = r.length;
    const items: { ol: string[]; row: number; col: number; w: number }[] = [];
    for (const entry of this.overlayStack) {
      if (entry.hidden) continue;
      const opt = entry.options ?? {};
      const m = typeof opt.margin === "number" ? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin } : opt.margin ?? {};
      const mt = Math.max(0, (m as { top?: number }).top ?? 0), mr = Math.max(0, (m as { right?: number }).right ?? 0), mb = Math.max(0, (m as { bottom?: number }).bottom ?? 0), ml = Math.max(0, (m as { left?: number }).left ?? 0);
      const aw = Math.max(1, tw - ml - mr), ah = Math.max(1, th - mt - mb);
      let w2 = typeof opt.width === "number" ? opt.width : opt.width?.endsWith("%") ? Math.floor(aw * parseFloat(opt.width) / 100) : Math.min(80, aw);
      if (opt.minWidth) w2 = Math.max(w2, opt.minWidth); w2 = Math.max(1, Math.min(w2, aw));
      const mh = opt.maxHeight ? (typeof opt.maxHeight === "number" ? opt.maxHeight : Math.floor(ah * parseFloat(opt.maxHeight) / 100)) : undefined;
      let ol = entry.component.render(w2);
      if (mh && ol.length > mh) ol = ol.slice(0, mh);
      const anchor = opt.anchor ?? "center";
      const row1 = anchor.includes("top") ? mt : anchor.includes("bottom") ? mt + ah - ol.length : mt + Math.floor((ah - ol.length) / 2);
      const col1 = anchor.includes("left") ? ml : anchor.includes("right") ? ml + aw - w2 : ml + Math.floor((aw - w2) / 2);
      const row = Math.max(0, row1 + (opt.offsetY ?? 0)); const col = Math.max(0, col1 + (opt.offsetX ?? 0));
      items.push({ ol, row, col, w: w2 }); minH = Math.max(minH, row + ol.length);
    }
    while (r.length < minH) r.push("");
    for (const { ol, row, col, w: ow } of items) {
      for (let i = 0; i < ol.length; i++) {
        const idx = Math.max(0, r.length - th) + row + i;
        if (idx >= 0 && idx < r.length) {
          const over = ol[i]; const base = r[idx]!;
          const before = base.slice(0, col); const after = base.slice(col + ow);
          r[idx] = before + over.slice(0, ow) + after;
        }
      }
    }
    return r;
  }
}
