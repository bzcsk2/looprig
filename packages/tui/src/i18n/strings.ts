/** i18n string definitions and locale management. */

export type Locale = 'zh-CN' | 'en';

export interface Strings {
  // Input
  placeholder: string;
  queued: (n: number) => string;
  processing: string;
  // Permission
  allow: string;
  alwaysAllow: string;
  deny: string;
  permissionTitle: string;
  requestsToExecute: string;
  parameters: (n: number) => string;
  permissionHint: string;
  // Message cards
  thinking: string;
  toolUse: string;
  you: string;
  assistant: string;
  reply: string;
  ctrlO: string;
  thinkingDots: string;
  // Status bar
  inputTokens: string;
  outputTokens: string;
  cacheHit: string;
  // Session picker
  sessions: string;
  sessionHint: string;
  loading: string;
  error: string;
  noSessions: string;
  msgs: (n: number) => string;
  // Model picker
  modelSettings: string;
  selectProvider: string;
  current: string;
  enterApiKey: (name: string) => string;
  escToGoBack: string;
  selectModel: (name: string) => string;
  // Slash commands
  cmdExit: string;
  cmdHelp: string;
  cmdModel: string;
  cmdSessions: string;
  cmdAgent: string;
  cmdSkill: string;
  cmdLang: string;
  // App
  pressCtrlC: string;
  shuttingDown: string;
  loadedSkills: (n: number) => string;
  failedLoadSkills: (e: string) => string;
  switchedTo: (label: string) => string;
  switchedModel: (provider: string, model: string) => string;
  switchedLang: (locale: string) => string;
  resumedSession: (id: string, n: number) => string;
  // StreamingCard
  writing: string;
  aborted: string;
  tps: (rate: string) => string;
  linesDropped: (n: number) => string;
  truncatedByEsc: string;
  // ToolCard
  rejected: string;
  exitCode: (code: number) => string;
  // CommandAutocomplete
  cmdAutocompleteHint: string;
  // Search
  searchHint: string;
  // Bridge
  unknownError: string;
  unknownWarning: string;
  unknown: string;
  // stringUtils
  plural: (n: number, word: string) => string;
}
