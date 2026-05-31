/** Theme tokens adapted from Reasonix for deepicode.
 *  Colors are cast to `any` because @deepicode/ink's type system expects
 *  Color | keyof Theme, but hex strings work at runtime. */

export interface ThemeTokens {
  fg: { strong: string; body: string; sub: string; meta: string; faint: string };
  tone: { brand: string; accent: string; ok: string; warn: string; err: string; info: string };
  surface: { bg: string; bgInput: string; bgCode: string; bgElev: string };
}

const dark: ThemeTokens = {
  fg: { strong: '#f4f7fb', body: '#d8dee9', sub: '#a7b1c2', meta: '#778294', faint: '#4d5666' },
  tone: { brand: '#7dd3fc', accent: '#c084fc', ok: '#86efac', warn: '#fbbf24', err: '#f87171', info: '#60a5fa' },
  surface: { bg: '#0b1020', bgInput: '#0f172a', bgCode: '#080c16', bgElev: '#151d2f' },
};

let activeTheme: ThemeTokens = dark;

export function setActiveTheme(theme: ThemeTokens): void { activeTheme = theme; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function proxyTokens(select: (t: ThemeTokens) => any): any {
  const target = select(dark);
  return new Proxy(target, {
    get: (_, prop: string | symbol) => select(activeTheme)[prop as string],
  });
}

export const FG: any = proxyTokens(t => t.fg);
export const TONE: any = proxyTokens(t => t.tone);
export const SURFACE: any = proxyTokens(t => t.surface);
