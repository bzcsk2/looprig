export { readLspConfig, normalizeConfig, getLanguageConfig, getRequestTimeout, getIdleTimeout, getInstallHint } from "./config.js"
export type { LspLanguageConfig, LspConfig, LspConfigResult } from "./config.js"

export { inferLanguage, getFileExtensions, LANGUAGE_EXTENSIONS } from "./language.js"

export {
  normalizeLocation,
  normalizeLocationArray,
  normalizeHover,
  normalizeDiagnostics,
  normalizeCompletion,
  normalizeDocumentSymbols,
  normalizeWorkspaceSymbols,
  normalizeRenameEdit,
  normalizeSignatureHelp,
  formatNormalizedItems,
} from "./normalize.js"
export type {
  NormalizedLocation,
  NormalizedHover,
  NormalizedDiagnostic,
  NormalizedCompletion,
  NormalizedSymbol,
  NormalizedItem,
} from "./normalize.js"
