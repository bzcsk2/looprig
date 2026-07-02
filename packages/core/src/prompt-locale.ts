/**
 * Core prompt locale module.
 *
 * Provides a singleton locale state that both core and TUI can read/write.
 * Persisted to .covalo/lang.json so language choice survives restarts.
 *
 * This module has zero dependencies on React, TUI, or any UI framework.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type PromptLocale = "zh-CN" | "en";

/** @note 按 PROMPT_LOCALE_SPEC.md 要求默认 locale 为 zh-CN */
export const DEFAULT_LOCALE: PromptLocale = "zh-CN";

let currentLocale: PromptLocale = DEFAULT_LOCALE;

export function normalizePromptLocale(value: unknown): PromptLocale {
  if (value === "en" || value === "english") return "en";
  if (value === "zh-CN" || value === "zh" || value === "chinese" || value === "中文") return "zh-CN";
  return DEFAULT_LOCALE;
}

export function setPromptLocale(locale: PromptLocale): void {
  currentLocale = locale;
}

export function getPromptLocale(): PromptLocale {
  return currentLocale;
}

export function isChinesePromptLocale(locale?: PromptLocale): boolean {
  return (locale ?? currentLocale) === "zh-CN";
}

/** Load locale from .covalo/lang.json. Returns null if file missing or invalid. */
export function loadPromptLocaleFromDisk(cwd?: string): PromptLocale | null {
  try {
    const filePath = join(cwd ?? process.cwd(), ".covalo", "lang.json");
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { lang?: string };
    if (parsed && typeof parsed.lang === "string") {
      return normalizePromptLocale(parsed.lang);
    }
    return null;
  } catch {
    return null;
  }
}

/** Save locale to .covalo/lang.json. */
export function savePromptLocaleToDisk(locale: PromptLocale, cwd?: string): void {
  try {
    const dirPath = join(cwd ?? process.cwd(), ".covalo");
    mkdirSync(dirPath, { recursive: true });
    const filePath = join(dirPath, "lang.json");
    writeFileSync(filePath, JSON.stringify({ lang: locale }, null, 2), "utf-8");
  } catch {
    // Best-effort persistence
  }
}
