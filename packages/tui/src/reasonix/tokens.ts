/** Theme tokens adapted from Reasonix for deepicode.
 *  Colors are cast to `any` because @deepicode/ink's type system expects
 *  Color | keyof Theme, but hex strings work at runtime. */

export interface ThemeTokens {
  fg: { strong: string; body: string; sub: string; meta: string; faint: string };
  tone: { brand: string; accent: string; ok: string; warn: string; err: string; info: string };
  surface: { bg: string; bgInput: string; bgCode: string; bgElev: string };
}

const dark: ThemeTokens = {
  // Terminal dashboard palette: black canvas, blue command surfaces, green activity.
  fg: { strong: '#ffffff', body: '#E1D3DC', sub: '#8D7B88', meta: '#8D7B88', faint: '#5D5159' },
  tone: { brand: '#00FF66', accent: '#4A90E2', ok: '#00FF66', warn: '#FFBD2E', err: '#FF5F56', info: '#4A90E2' },
  surface: { bg: '#000000', bgInput: '#1D3B5C', bgCode: '#0C0C0C', bgElev: '#13283F' },
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
