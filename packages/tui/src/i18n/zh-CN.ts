import type { Strings } from './strings.js';

export const zhCN: Strings = {
  // Input
  placeholder: '输入消息...',
  queued: (n) => ` (${n} 条排队)`,
  processing: ' (处理中...)',
  // Permission
  allow: '允许',
  alwaysAllow: '始终允许',
  deny: '拒绝',
  permissionTitle: '权限确认',
  requestsToExecute: ' 请求执行：',
  parameters: (n) => `${n} 个参数`,
  permissionHint: '↑↓ 选择 · Enter 确认 · Esc 拒绝',
  // Message cards
  thinking: '思考',
  toolUse: '工具调用',
  you: '你',
  assistant: '助手',
  reply: '回复',
  ctrlO: 'ctrl+o',
  thinkingDots: ' 思考中...',
  // Status bar
  inputTokens: '入',
  outputTokens: '出',
  cacheHit: '缓存',
  // Session picker
  sessions: '会话',
  sessionHint: ' (↑↓ 选择, Enter 恢复, Esc 取消)',
  loading: '加载中...',
  error: '错误：',
  noSessions: '没有已保存的会话。',
  msgs: (n) => ` 条消息`,
  // Model picker
  modelSettings: '模型设置',
  selectProvider: '选择服务商 (↑↓ Enter, Ctrl+C 取消)：',
  current: ' (当前)',
  enterApiKey: (name) => `输入 ${name} 的 API Key：`,
  escToGoBack: '  Esc 返回',
  selectModel: (name) => `${name} — 选择模型 (↑↓ Enter)：`,
  // Slash commands
  cmdExit: '退出',
  cmdHelp: '显示帮助',
  cmdModel: '切换服务商/模型',
  cmdSessions: '浏览历史会话',
  cmdAgent: '切换 Agent',
  cmdSkill: '列出已加载技能',
  cmdLang: '切换语言',
  // App
  pressCtrlC: '再次按 Ctrl+C 退出',
  shuttingDown: '正在关闭...',
  loadedSkills: (n) => `已加载 ${n} 个技能。\n`,
  failedLoadSkills: (e) => `加载技能失败：${e}`,
  switchedTo: (label) => `已切换到 ${label}`,
  switchedModel: (provider, model) => `已切换到 ${provider} / ${model}`,
  switchedLang: (locale) => `已切换到${locale === 'zh-CN' ? '中文' : 'English'}`,
  resumedSession: (id, n) => `已恢复会话 ${id}...（${n} 条消息）`,
  // StreamingCard
  writing: '生成中',
  aborted: '已中断',
  tps: (rate) => `${rate} t/s`,
  linesDropped: (n) => `... +${n} 行`,
  truncatedByEsc: '被 Esc 截断',
  // ToolCard
  rejected: '已拒绝',
  exitCode: (code) => `退出码 ${code}`,
  // CommandAutocomplete
  cmdAutocompleteHint: '↑↓ 选择 · Enter/Tab 补全 · Esc 关闭',
  // Search
  searchHint: 'Enter 下一个 · ↑ 上一个 · Esc 关闭',
  // Bridge
  unknownError: '未知错误',
  unknownWarning: '未知警告',
  unknown: '未知',
  // stringUtils
  plural: (n, word) => n === 1 ? word : word + 's',
};
