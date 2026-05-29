const ESC = "\x1b";
function isComplete(data: string): "complete"|"incomplete"|"not-escape" {
  if (!data.startsWith(ESC)) return "not-escape";
  if (data.length === 1) return "incomplete";
  const a = data.slice(1);
  if (a.startsWith("[")) return isCompleteCSI(data);
  if (a.startsWith("]")) return data.endsWith("\x07") || data.endsWith(`${ESC}\\`) ? "complete" : "incomplete";
  if (a.startsWith("P") || a.startsWith("_")) return data.endsWith(`${ESC}\\`) ? "complete" : "incomplete";
  if (a.startsWith("O")) return a.length >= 2 ? "complete" : "incomplete";
  if (a.startsWith(ESC)) { const c = a.charCodeAt(1); if (c === 0x5b || c === 0x4f) return isComplete(a); return "complete"; }
  if (a.length === 1) return "complete";
  return "complete";
}
function isCompleteCSI(data: string): "complete"|"incomplete" {
  if (data.length < 3) return "incomplete";
  const last = data[data.length - 1]!; const lc = last.charCodeAt(0);
  if (lc >= 0x40 && lc <= 0x7e) return "complete";
  return "incomplete";
}
function extract(buf: string): { seqs: string[]; rem: string } {
  const seqs: string[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const rem = buf.slice(pos);
    if (rem.startsWith(ESC)) {
      let end = 1;
      while (end <= rem.length) {
        const s = isComplete(rem.slice(0, end));
        if (s === "complete") { seqs.push(rem.slice(0, end)); pos += end; break; }
        if (s === "incomplete") { end++; continue; }
        seqs.push(rem.slice(0, end)); pos += end; break;
      }
      if (end > rem.length) return { seqs, rem: rem };
    } else { seqs.push(rem[0]!); pos++; }
  }
  return { seqs, rem: "" };
}

const BP_START = "\x1b[200~"; const BP_END = "\x1b[201~";
type Listener = (seq: string) => void;
export class StdinBuffer {
  #buf = ""; #timer?: ReturnType<typeof setTimeout>; #tm: number;
  #paste = false; #pasteBuf = ""; #pasteSeqs: string[] = [];
  #dataListeners: Listener[] = []; #pasteListeners: Listener[] = [];
  constructor(opts: { timeout?: number } = {}) { this.#tm = opts.timeout ?? 10; }
  on(ev: "data"|"paste", fn: Listener): void { if (ev === "data") this.#dataListeners.push(fn); else this.#pasteListeners.push(fn); }
  #emit(ev: "data"|"paste", s: string): void { for (const fn of ev === "data" ? this.#dataListeners : this.#pasteListeners) fn(s); }
  process(data: string | Buffer): void {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    const str = typeof data === "string" ? data : data.toString();
    if (this.#paste) {
      this.#pasteBuf += str;
      const end = this.#pasteBuf.indexOf(BP_END);
      if (end >= 0) {
        this.#paste = false;
        const content = this.#pasteBuf.slice(0, end);
        const remain = this.#pasteBuf.slice(end + BP_END.length);
        this.#pasteBuf = "";
        this.#emit("paste", content);
        if (remain) this.#pasteSeqs.push(remain);
      }
      return;
    }
    this.#buf += str;
    const si = this.#buf.indexOf(BP_START);
    if (si >= 0) {
      if (si > 0) { const r = extract(this.#buf.slice(0, si)); for (const s of r.seqs) this.#emit("data", s); }
      this.#paste = true; this.#pasteBuf = this.#buf.slice(si + BP_START.length); this.#buf = "";
      const end = this.#pasteBuf.indexOf(BP_END);
      if (end >= 0) {
        this.#paste = false; const content = this.#pasteBuf.slice(0, end); const remain = this.#pasteBuf.slice(end + BP_END.length);
        this.#pasteBuf = ""; this.#emit("paste", content);
        if (remain) this.#pasteSeqs.push(remain);
      }
      return;
    }
    const r = extract(this.#buf); this.#buf = r.rem;
    const pasteSeqs = this.#pasteSeqs; this.#pasteSeqs = [];
    for (const s of pasteSeqs) this.#emit("data", s);
    for (const s of r.seqs) this.#emit("data", s);
    if (this.#buf.length > 0) this.#timer = setTimeout(() => { const f = this.flush(); for (const s of f) this.#emit("data", s); }, this.#tm);
  }
  flush(): string[] { if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; } if (!this.#buf) return []; const s = [this.#buf]; this.#buf = ""; return s; }
  clear(): void { if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; } this.#buf = ""; this.#paste = false; this.#pasteBuf = ""; this.#pasteSeqs = []; }
  destroy(): void { this.clear(); }
}
