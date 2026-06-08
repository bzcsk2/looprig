import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TuiSettingsSchema } from './settings-schema.js';

export interface PersistedSkill {
  name: string;
  description: string;
  content: string;
}

export interface TuiSettings {
  agent?: string;
  thinkingMode?: string;
  activeSkills?: PersistedSkill[];
}

const SETTINGS_DIR = '.deepicode';
const SETTINGS_FILE = 'ui-settings.json';

function settingsPath(): string {
  return join(process.cwd(), SETTINGS_DIR, SETTINGS_FILE);
}

export function loadTuiSettings(): TuiSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = TuiSettingsSchema["~standard"].validate(parsed);
    // validate can be sync or async in Standard Schema
    if (result && typeof result === 'object' && 'then' in result) {
      return parsed as TuiSettings
    }
    if ('value' in (result as { value: unknown })) {
      return (result as { value: TuiSettings }).value
    }
    return parsed as TuiSettings
  } catch {
    return {};
  }
}

export function saveTuiSettings(patch: Partial<TuiSettings>): void {
  try {
    const current = loadTuiSettings();
    const next = { ...current, ...patch };
    const dir = join(process.cwd(), SETTINGS_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // TUI settings persistence must not break interaction.
  }
}
