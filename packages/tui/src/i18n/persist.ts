/** Language preference persistence — reads/writes .deepicode/lang.json */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Locale } from './strings.js';
import { LangConfigSchema } from '../settings-schema.js';

const LANG_FILE = '.deepicode/lang.json';

function getConfigDir(): string {
  return join(process.cwd(), '.deepicode');
}

export function loadLang(): Locale | null {
  try {
    const dir = getConfigDir();
    const raw = readFileSync(join(dir, 'lang.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const result = LangConfigSchema["~standard"].validate(parsed);
    if (result && typeof result === 'object' && 'then' in result) {
      return null
    }
    if ('value' in (result as { value: unknown })) {
      return (result as { value: { lang: Locale } }).value.lang
    }
    return null
  } catch {}
  return null;
}

export function saveLang(locale: Locale): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lang.json'), JSON.stringify({ lang: locale }, null, 2), 'utf8');
}
