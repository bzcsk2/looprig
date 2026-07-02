import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TuiSettingsSchema } from './settings-schema.js';

export interface PersistedSkill {
  name: string;
  description: string;
  content: string;
}

/** 工作流模式：alone（单 agent）/ subagent（supervisor 自主调度）/ loop（固定双角色编排）/ eval（评测模式） */
export type WorkflowMode = 'alone' | 'subagent' | 'loop' | 'eval';

export interface TuiSettings {
  agent?: string;
  thinkingMode?: string;
  activeSkills?: PersistedSkill[];
  theme?: string;
  workflowMode?: WorkflowMode;
}

const SETTINGS_DIR = '.covalo';
const SETTINGS_FILE = 'ui-settings.json';

function settingsPath(): string {
  return join(process.cwd(), SETTINGS_DIR, SETTINGS_FILE);
}

export function loadTuiSettings(): TuiSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = TuiSettingsSchema["~standard"].validate(parsed);
    if (result && typeof result === 'object' && 'then' in result) {
      return {}
    }
    if ('value' in (result as { value: unknown })) {
      return normalizeSettings((result as { value: Partial<TuiSettings> }).value)
    }
    return {}
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

function normalizeSettings(settings: Partial<TuiSettings>): TuiSettings {
  return {
    ...(typeof settings.agent === 'string' && settings.agent ? { agent: settings.agent } : {}),
    ...(typeof settings.thinkingMode === 'string' && settings.thinkingMode ? { thinkingMode: settings.thinkingMode } : {}),
    ...(Array.isArray(settings.activeSkills) ? { activeSkills: settings.activeSkills.filter(isPersistedSkill).map(s => ({ name: s.name, description: s.description, content: s.content })) } : {}),
    ...(typeof settings.theme === 'string' && settings.theme ? { theme: settings.theme } : {}),
    ...(settings.workflowMode === 'alone' || settings.workflowMode === 'subagent' || settings.workflowMode === 'loop' || settings.workflowMode === 'eval' ? { workflowMode: settings.workflowMode } : {}),
  }
}

function isPersistedSkill(value: unknown): value is PersistedSkill {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string'
    && typeof record.description === 'string'
    && typeof record.content === 'string';
}
