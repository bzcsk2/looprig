/**
 * Prompt locale — singleton locale state and persistence.
 *
 * @module
 */
export {
  normalizePromptLocale,
  setPromptLocale,
  getPromptLocale,
  isChinesePromptLocale,
  loadPromptLocaleFromDisk,
  savePromptLocaleToDisk,
} from "../prompt-locale.js";
export type { PromptLocale } from "../prompt-locale.js";
