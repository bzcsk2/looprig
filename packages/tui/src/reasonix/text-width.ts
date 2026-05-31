import stringWidthLib from 'string-width';

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), seg => seg.segment);
}

export function graphemeWidth(g: string): 0 | 1 | 2 {
  if (g.length === 0) return 0;
  const w = stringWidthLib(g);
  if (w <= 0) return 0;
  if (w >= 2) return 2;
  return 1;
}

export function stringWidth(s: string): number {
  return stringWidthLib(s);
}

export function padToCells(text: string, cells: number): string {
  const w = stringWidthLib(text);
  if (w >= cells) return text;
  return text + ' '.repeat(cells - w);
}

export function clipToCells(s: string, maxCells: number): string {
  if (maxCells <= 0) return '';
  if (stringWidthLib(s) <= maxCells) return s;
  const cap = maxCells - 1;
  let out = '';
  let cells = 0;
  for (const g of graphemes(s)) {
    const w = graphemeWidth(g);
    if (cells + w > cap) break;
    out += g;
    cells += w;
  }
  return `${out}\u2026`;
}

export function wrapToCells(s: string, maxCells: number): string[] {
  if (maxCells <= 0) return [];
  if (s.length === 0) return [''];
  const out: string[] = [];
  let cur = '';
  let cells = 0;
  for (const g of graphemes(s)) {
    const w = graphemeWidth(g);
    if (cells + w > maxCells) { out.push(cur); cur = g; cells = w; }
    else { cur += g; cells += w; }
  }
  if (cur.length > 0 || out.length === 0) out.push(cur);
  return out;
}
