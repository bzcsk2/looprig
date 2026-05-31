const NAMED: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: '\u00a0' };
const ENTITY_RE = /&(?:#x([0-9A-Fa-f]+)|#(\d+)|([a-zA-Z]+));/g;

export function decodeHtmlEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(ENTITY_RE, (match, hex, dec, name) => {
    if (hex !== undefined) { const c = Number.parseInt(hex, 16); return Number.isFinite(c) && c > 0 ? String.fromCodePoint(c) : match; }
    if (dec !== undefined) { const c = Number.parseInt(dec, 10); return Number.isFinite(c) && c > 0 ? String.fromCodePoint(c) : match; }
    if (name !== undefined) { const l = name.toLowerCase(); return NAMED[l] ?? match; }
    return match;
  });
}
