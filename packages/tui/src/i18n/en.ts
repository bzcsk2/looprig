import type { Strings } from './strings.js';

export const en: Strings = {
  // Input
  placeholder: 'Type a message...',
  queued: (n) => ` (${n} queued)`,
  processing: ' (processing...)',
  pasteSummary: (n) => `[Pasted +${n} lines]`,
  // Permission
  allow: 'Allow',
  alwaysAllow: 'Always Allow',
  deny: 'Deny',
  permissionTitle: 'Permission Confirmation',
  requestsToExecute: ' requests to execute:',
  parameters: (n) => `${n} parameters`,
  permissionHint: '↑↓ select · Enter confirm · Esc deny',
  // Message cards
  thinking: 'Thinking',
  toolUse: 'Tool use',
  you: 'You',
  assistant: 'Assistant',
  reply: 'Reply',
  ctrlO: 'ctrl+o',
  thinkingDots: ' thinking...',
  roleWorker: 'Worker',
  roleSupervisor: 'Supervisor',
  roleUnknown: 'AI',
  // Status bar
  inputTokens: 'in',
  outputTokens: 'out',
  cacheHit: 'hit',
  // Session picker
  sessions: 'Sessions',
  sessionHint: ' (↑↓ select, Enter resume, Esc cancel)',
  loading: 'Loading...',
  error: 'Error: ',
  noSessions: 'No saved sessions found.',
  msgs: (n) => ` msgs`,
  // Model picker
  modelSettings: 'Model Settings',
  selectProvider: 'Select provider (↑↓ Enter, Ctrl+C to cancel):',
  current: ' (current)',
  enterApiKey: (name) => `Enter API key for ${name}:`,
  escToGoBack: '  Esc to go back',
  selectModel: (name) => `${name} — select model (↑↓ Enter):`,
  // Slash commands
  cmdExit: 'exit',
  cmdHelp: 'show help',
  cmdModel: 'switch provider/model',
  cmdSessions: 'browse past sessions',
  cmdAgent: 'switch agent (deprecated, use dual-role mode)',
  cmdSkill: 'manage skills',
  cmdLang: 'switch language',
  cmdStatus: 'show runtime status',
  cmdContext: 'configure context trim/compact',
  // App
  pressCtrlC: 'Press Ctrl+C again to exit',
  shuttingDown: 'Shutting down...',
  loadedSkills: (n) => `Loaded ${n} skills.\n`,
  failedLoadSkills: (e) => `Failed to load skills: ${e}`,
  switchedTo: (label) => `Switched to ${label}`,
  switchedModel: (provider, model) => `Switched to ${provider} / ${model}`,
  switchedLang: (locale) => `Switched to ${locale === 'zh-CN' ? '中文' : 'English'}`,
  resumedSession: (id, n) => `Resumed session ${id}... (${n} messages)`,
  // StreamingCard
  writing: 'writing',
  aborted: 'aborted',
  tps: (rate) => `${rate} t/s`,
  linesDropped: (n) => `... +${n} lines`,
  truncatedByEsc: 'truncated by Esc',
  // ToolCard
  rejected: 'rejected',
  exitCode: (code) => `exit ${code}`,
  // CommandAutocomplete
  cmdAutocompleteHint: '↑↓ select · Enter execute · Tab complete · Esc close',
  // Search
  searchHint: 'Enter next · ↑ previous · Esc close',
  // Bridge
  unknownError: 'Unknown error',
  unknownWarning: 'Unknown warning',
  unknown: 'unknown',
  // P3: Mid-session instruction queue
  pendingTasks: 'Pending:',
  // stringUtils
  plural: (n, word) => n === 1 ? word : word + 's',
};
