import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
    const parsed = JSON.parse(raw) as Partial<TuiSettings>;
    return normalizeSettings(parsed);
  } catch {
    return {};
  }
}

export function saveTuiSettings(patch: Partial<TuiSettings>): void {
  try {
    const current = loadTuiSettings();
    const next = normalizeSettings({ ...current, ...patch });
    const dir = join(process.cwd(), SETTINGS_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // TUI settings persistence must not break interaction.
  }
}

function normalizeSettings(settings: Partial<TuiSettings>): TuiSettings {
  const normalized: TuiSettings = {};
  if (typeof settings.agent === 'string' && settings.agent) {
    normalized.agent = settings.agent;
  }
  if (typeof settings.thinkingMode === 'string' && settings.thinkingMode) {
    normalized.thinkingMode = settings.thinkingMode;
  }
  if (Array.isArray(settings.activeSkills)) {
    normalized.activeSkills = settings.activeSkills
      .filter(isPersistedSkill)
      .map(skill => ({ name: skill.name, description: skill.description, content: skill.content }));
  }
  return normalized;
}

function isPersistedSkill(value: unknown): value is PersistedSkill {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string'
    && typeof record.description === 'string'
    && typeof record.content === 'string';
}
