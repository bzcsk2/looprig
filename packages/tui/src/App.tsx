import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Box, AlternateScreen, instances, SHOW_CURSOR, EXIT_ALT_SCREEN, useInput } from '@deepreef/ink';
import type { ScrollBoxHandle } from '@deepreef/ink';
import { writeSync } from 'node:fs';
import type { ReasonixEngine } from '@deepreef/core';
import type { ChatMessage, DeepreefConfig } from '@deepreef/core';
import { PROVIDERS, AGENTS, defaultAgentRegistry, getModelContextWindow, saveLastConfig } from '@deepreef/core';
import { resolveHarnessStrictness, readProjectHarnessConfig, writeProjectHarnessConfig } from '@deepreef/core';
import { createBridge, timelineFromMessages, type BridgeState } from './bridge.js';
import type { DualAgentRuntime } from '@deepreef/core/dual-agent-runtime/dual-runtime.js';
import type { WorkflowCoordinator } from '@deepreef/core/workflow-coordinator/coordinator.js';
import { TranscriptProvider } from './store/TranscriptContext.js';
import { BridgeRuntimeProvider } from './store/BridgeRuntimeContext.js';
import { isBridgeRuntimeSplitEnabled, isTranscriptStoreEnabled } from './store/feature.js';
import { WelcomeWhenEmpty } from './WelcomeWhenEmpty.js';
import { BridgeDeepiPromptInput, BridgeScrollAlerts, BridgeStatusBar } from './BridgeConnected.js';
import { DeepiMessages } from './DeepiMessages.js';
import type { DeepiPromptInputHandle } from './DeepiPromptInput.js';
import { FullscreenLayout } from './FullscreenLayout.js';
import { useMessageScroll } from './useMessageScroll.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { isFullscreenEnvEnabled, isMouseTrackingEnabled } from './fullscreen.js';
import { ModelPicker } from './ModelPicker.js';
import { SessionPicker } from './SessionPicker.js';
import { CommandAutocomplete } from './CommandAutocomplete.js';
import { SearchOverlay } from './SearchOverlay.js';
import { CenteredStage } from './CenteredStage.js';
import { ChoiceMenu } from './ChoiceMenu.js';
import { SkillModal } from './SkillModal.js';
import { ContextModal } from './ContextModal.js';
import { formatStatus } from './status/format.js';
import { t, setLocale } from './i18n/index.js';
import { loadTuiSettings, saveTuiSettings } from './settings.js';
import {
  buildHelpText,
  parseSlashCommand,
  validateThinkingMode,
} from './commands.js';
// TUI-GM: Gemini CLI 风格组件
import { OrchestrationSummary } from './components/orchestration/OrchestrationSummary.js';
import { LoadingIndicator } from './components/shared/LoadingIndicator.js';
import { AgentGroupDisplay } from './components/agents/AgentGroupDisplay.js';
import { WorkerActivityPanel } from './components/workers/WorkerActivityPanel.js';
import { DialogManager } from './components/dialogs/DialogManager.js';
// DA-R6: 双角色组件
import { DualTabSystem, WorkflowStatusBar } from './components/workflow/index.js';
import type { AgentRole, WorkflowPhase, WorkflowState } from './components/workflow/index.js';
// TUI-FIX-20: 编排状态存储
import { OrchestrationStore } from './store/orchestration-store.js';
// TUI-FIX-30: 编排状态 hooks
import { OrchestrationStoreProvider, useOrchestrationWorkers, useOrchestrationSupervisors, useOrchestrationLoop } from './components/orchestration/OrchestrationContext.js';
// TUI-FIX-60: 主题管理器
import { themeManager } from './theme/theme-manager.js';

// ---- 模块级中断/退出状态（由 SIGINT 处理器和 useInput \x03 处理器共享） ----

/** TUI 运行状态: 'idle' 空闲 / 'loading' 加载中 */
let tuiState: 'idle' | 'loading' = 'idle';
export function setTUIState(s: 'idle' | 'loading') { tuiState = s; }

/** 退出双击计时器: 首次 Ctrl+C 后启动，2 秒内再次按下则执行退出 */
let exitTimer: ReturnType<typeof setTimeout> | null = null;
/** 退出挂起标志: 为 true 时忽略后续中断信号 */
let exitPending = false;

/**
 * 模块级回调 —— 由 App 组件挂载时注入。
 * 模块级回调（供 doInterrupt 与 SIGINT handler 共享）。
 * 注意：这些变量在每次 App 渲染时被重新赋值，单实例 TUI 下安全。
 */
let _cancel: (() => void) | null = null;
let _interrupt: (() => void) | null = null;
let _setStatusMsg: ((m: string | null) => void) | null = null;

/**
 * 清理终端环境。
 * 依次执行：禁用鼠标跟踪 → 卸载 Ink 实例退出备用屏幕 → 排空 stdin → 分离实例并恢复 raw mode → 显示光标。
 * 此函数在退出前被调用，确保终端恢复至正常状态。
 */
function cleanupTerminal(): void {
  const inst = instances.get(process.stdout);

  // 1. Disable mouse tracking FIRST — gives terminal time to process
  //    while we're busy unmounting the React tree
  try { writeSync(1, '\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l'); } catch {}

  // 2. Full Ink unmount — renders last frame on alt buffer, exits alt screen,
  //    unsubscribes from signal-exit so it won't double-fire on process.exit
  if (inst?.isAltScreenActive) {
    try {
      inst.unmount();
    } catch {
      try { writeSync(1, EXIT_ALT_SCREEN); } catch {}
    }
  }

  // 3. Drain stdin — catches mouse/input events that arrived during tree-walk
  try { inst?.drainStdin(); } catch {}

  // 4. Mark unmounted + restore raw mode so signal-exit won't re-run unmount()
  try { inst?.detachForShutdown(); } catch {}

  // 5. Show cursor
  try { writeSync(1, SHOW_CURSOR); } catch {}
}

/**
 * 中断处理（Ctrl+C 处理器）。
 * - loading 状态：调用 _cancel 取消当前请求
 * - idle 状态：首次按下启动 2 秒退出倒计时；倒计时内再次按下则直接退出进程
 */
function doInterrupt(): void {
  if (exitPending) return;

  if (tuiState === 'loading') {
    _cancel?.();
    return;
  }

  // Idle: double-tap to exit
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = null;
    exitPending = true;
    _interrupt?.();
    cleanupTerminal();
    process.exit(0);
  }

  exitTimer = setTimeout(() => { exitTimer = null; _setStatusMsg?.(null); }, 2000);
  _setStatusMsg?.(t().pressCtrlC);
}

const initialState: BridgeState = {
  timeline: [],
  isLoading: false,
  messageQueue: [],
  pendingInstructionCount: 0,
  tokens: { input: 0, output: 0, cacheHit: 0, cacheMiss: 0 },
  contextUsage: 0,
  warnings: [],
  error: null,
  permissionPrompt: null,
  questionPrompt: null,
  reasoningActive: false,
};

const MAX_INPUT_HISTORY = 100;

interface SkillRecord {
  name: string;
  description: string;
  content: string;
}

/**
 * 从输入文本中提取技能标签（以 # 开头的单词）。
 * @param text - 用户输入文本
 * @returns 去重后的技能名称列表
 */
function extractSkillTags(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:^|\s)#([A-Za-z0-9_.-]+)/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function parseSkillDetail(content: string): SkillRecord {
  const parsed = JSON.parse(content) as Partial<SkillRecord>;
  if (!parsed.name || !parsed.description || !parsed.content) {
    throw new Error('invalid skill payload');
  }
  return { name: parsed.name, description: parsed.description, content: parsed.content };
}

/**
 * 根据技能名称列表加载对应的技能记录。
 * 遍历名称列表，依次调用 createSkillTool 执行 load 命令获取技能内容并解析。
 * @param names - 技能名称数组
 * @returns 技能记录列表（失败项自动跳过）
 */
async function loadTaggedSkills(names: string[]): Promise<SkillRecord[]> {
  if (names.length === 0) return [];
  const { createSkillTool } = await import('@deepreef/tools');
  const tool = createSkillTool();
  const loaded: SkillRecord[] = [];
  for (const name of names) {
    const output = await tool.execute({ command: 'load', query: name }, { cwd: process.cwd(), sessionId: '' });
    if (output.isError) continue;
    const content = typeof output.content === 'string' ? output.content : String(output.content ?? '');
    loaded.push(parseSkillDetail(content));
  }
  return loaded;
}

export function getProviderLabel(provider: string): string {
  const info = PROVIDERS[provider];
  return info ? info.label : provider;
}

interface AppProps {
  engine: ReasonixEngine;
  config: DeepreefConfig;
  pluginCount?: number;
  contentPackCount?: number;
  assetCounts?: { skills: number; agents: number; rules: number; commands: number; mcp: number; hooks: number };
  diagnosticCounts?: { errors: number; warnings: number };
  onUserInput?: (text: string) => void;
  beforeSubmit?: () => Promise<void>;
  dualRuntime?: DualAgentRuntime;
  workflowCoordinator?: WorkflowCoordinator;
}

/**
 * App —— 终端用户界面的根组件。
 *
 * 职责：
 * - 管理 Bridge（与 LLM 引擎通信的桥梁）生命周期
 * - 维护全部 UI 状态（消息时间线、模型选择、技能、Agent、语言等）
 * - 处理键盘输入（Ctrl+C 中断、Ctrl+F 搜索、提交消息、斜杠命令等）
 * - 根据状态变量切换显示覆盖层（模型选择器 / 会话选择器 / Agent 菜单等）
 * - 组合主内容区 (scrollableContent) 与底部输入区 (bottomContent)
 *
 * @param engine - ReasonixEngine 实例，驱动 LLM 通信
 * @param config - DeepreefConfig 配置对象（provider / model / contextWindow 等）
 */
/**
 * 内部组件：从 OrchestrationStore 读取实时数据并渲染 OrchestrationSummary。
 * 必须在 OrchestrationStoreProvider 内部使用。
 */
function OrchestrationSummaryFromStore({ terminalWidth }: { terminalWidth: number }) {
  const workers = useOrchestrationWorkers();
  const supervisors = useOrchestrationSupervisors();
  const loop = useOrchestrationLoop();
  return (
    <OrchestrationSummary
      workers={workers}
      supervisors={supervisors}
      loopPhase={loop.phase}
      loopAttempt={loop.attempt}
      terminalWidth={terminalWidth}
    />
  );
}

/**
 * 内部组件：从 OrchestrationStore 读取 Worker 数据并渲染 AgentGroupDisplay。
 */
function AgentGroupDisplayFromStore({ terminalWidth }: { terminalWidth: number }) {
  const workers = useOrchestrationWorkers();
  if (workers.length === 0) return null;
  return (
    <AgentGroupDisplay
      workers={workers}
      terminalWidth={terminalWidth}
    />
  );
}

export function App({ engine, config, pluginCount = 0, contentPackCount = 0, assetCounts, diagnosticCounts, onUserInput, beforeSubmit, dualRuntime, workflowCoordinator }: AppProps) {
  // TUI-FIX-20: 编排状态存储（引擎生命周期内持久）
  const [orchestrationStore] = useState(() => new OrchestrationStore());

  // TUI-FIX-20: 连接引擎编排事件发射器
  useEffect(() => {
    engine.setOnOrchestrationEvent?.((event) => {
      if (event.orchestration) {
        orchestrationStore.apply(event.orchestration);
      }
    });
    return () => {
      engine.setOnOrchestrationEvent?.(() => {});
    };
  }, [engine, orchestrationStore]);

  const persistedSettings = useMemo(() => loadTuiSettings(), []);

  // TUI-FIX-60: 启动时恢复已持久化的主题
  useEffect(() => {
    if (persistedSettings.theme) {
      themeManager.setActiveTheme(persistedSettings.theme);
    }
  }, [persistedSettings.theme]);
  const persistedThinkingMode = persistedSettings.thinkingMode && !validateThinkingMode(persistedSettings.thinkingMode)
    ? persistedSettings.thinkingMode
    : undefined;
  const persistedAgent = persistedSettings.agent && (AGENTS[persistedSettings.agent] || defaultAgentRegistry.get(persistedSettings.agent))
    ? persistedSettings.agent
    : undefined;
  const [thinkingMode, setThinkingMode] = useState(persistedThinkingMode ?? 'off');

  // TUI-FIX: 将 TUI 的 thinkingMode 传递给 Engine，控制 DeepSeek API thinking 参数
  useEffect(() => {
    engineRef.current.setThinkingMode?.(thinkingMode as 'off' | 'open' | 'high');
  }, [thinkingMode]);
  const [bridgeState, setBridgeState] = useState<BridgeState>(() => ({ ...initialState }));
  const bridge = useMemo(() => createBridge(engine, setBridgeState, onUserInput, beforeSubmit, orchestrationStore, dualRuntime, workflowCoordinator), [engine, onUserInput, beforeSubmit, orchestrationStore, dualRuntime, workflowCoordinator]);
  const transcriptReader = useMemo(() => bridge.getTranscriptReader(), [bridge]);
  const bridgeRuntime = useMemo(() => bridge.getBridgeRuntime(), [bridge]);
  const bridgeSplit = isBridgeRuntimeSplitEnabled();
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const contextTotal = engine.getContextWindow?.() ?? config.contextWindow ?? 128_000;
  const engineRef = useRef(engine);
  const mountedRef = useRef(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const appendMessage = useCallback((message: ChatMessage) => {
    bridgeRef.current.appendTimelineMessage(message);
  }, []);

  // 模块级回调在每次渲染更新（单实例 TUI 安全）。SIGINT handler 使用独立 ref 避免闭包陈旧。
  _cancel = () => bridgeRef.current.cancel();
  _interrupt = () => engineRef.current.interrupt();
  _setStatusMsg = setStatusMessage;

  const sigCancelRef = useRef<(() => void) | null>(null);
  const sigInterruptRef = useRef<(() => void) | null>(null);
  const sigSetMsgRef = useRef<((m: string | null) => void) | null>(null);
  sigCancelRef.current = _cancel;
  sigInterruptRef.current = _interrupt;
  sigSetMsgRef.current = setStatusMessage;

  // SIGINT handler（使用 ref 读取最新值，降低严格模式风险）
  useEffect(() => {
    const handler = () => {
      if (exitPending) return;
      const cancel = sigCancelRef.current;
      const interrupt = sigInterruptRef.current;
      const setMsg = sigSetMsgRef.current;

      if (tuiState === 'loading') {
        cancel?.();
        return;
      }
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
        exitPending = true;
        interrupt?.();
        cleanupTerminal();
        process.exit(0);
      }
      exitTimer = setTimeout(() => { exitTimer = null; setMsg?.(null); }, 2000);
      setMsg?.(t().pressCtrlC);
    };
    process.on('SIGINT', handler);
    return () => { process.off('SIGINT', handler); };
  }, []);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // \x03 character handler (raw mode working properly — Ctrl+C arrives as character)
  useInput((input, key) => {
    if (input === '\x03' || (key.ctrl && input === 'c')) {
      doInterrupt();
    }
    if (key.ctrl && input === 'f') {
      setShowSearch(prev => !prev);
    }
  });

  /** 取消当前 LLM 请求 */
  const handleCancel = useCallback(() => {
    bridgeRef.current.cancel();
  }, []);
  const scrollRef = useRef<ScrollBoxHandle | null>(null);
  const promptInputRef = useRef<DeepiPromptInputHandle>(null);

  const [activeProvider, setActiveProvider] = useState(config.provider ?? 'zen'); // 当前选中的 LLM 提供商
  const [activeModel, setActiveModel] = useState(config.model);                  // 当前选中的模型名称
  const [inputText, setInputText] = useState('');                                // 用户输入框当前文本
  const [showAutocomplete, setShowAutocomplete] = useState(false);               // 是否显示命令自动补全面板
  const [showModelPicker, setShowModelPicker] = useState(false);                 // 是否显示模型选择器覆盖层
  const [showSessionPicker, setShowSessionPicker] = useState(false);             // 是否显示会话选择器覆盖层
  const [showAgentMenu, setShowAgentMenu] = useState(false);                     // 是否显示 Agent 切换菜单覆盖层
  const [showLangMenu, setShowLangMenu] = useState(false);                       // 是否显示语言切换菜单覆盖层
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);               // 是否显示推理档位选择菜单覆盖层
  const [showSkillModal, setShowSkillModal] = useState(false);                   // 是否显示技能管理弹窗覆盖层
  const [showContextModal, setShowContextModal] = useState(false);               // 是否显示上下文策略管理弹窗覆盖层
  const [showHarnessMenu, setShowHarnessMenu] = useState(false);                 // 是否显示 Harness 严格度选择菜单
  const [showSearch, setShowSearch] = useState(false);                           // 是否显示搜索覆盖层（Ctrl+F 触发）
  // ADV-HAR-01: Harness 三档严格度状态
  const initialStrictness = useMemo(() => {
    const projectConfig = readProjectHarnessConfig();
    const resolved = resolveHarnessStrictness({
      projectConfig,
      modelName: config.model,
    });
    return resolved;
  }, [config.model]);
  const [harnessStrictness, setHarnessStrictness] = useState<'strict' | 'normal' | 'loose'>(initialStrictness.strictness);
  const [harnessSource, setHarnessSource] = useState(initialStrictness.source);
  const modalBlocksScroll = showSearch
    || showModelPicker
    || showSessionPicker
    || showAgentMenu
    || showLangMenu
    || showThinkingMenu
    || showSkillModal
    || showContextModal
    || showHarnessMenu
    || showAutocomplete;
  useMessageScroll(scrollRef, !modalBlocksScroll);
  const [activeAgent, setActiveAgent] = useState(persistedAgent ?? engine.getAgentName?.() ?? 'build'); // 当前 Agent 名称
  const [activeSkills, setActiveSkills] = useState(persistedSettings.activeSkills ?? engine.getActiveSkills?.() ?? []); // 当前已启用的技能列表
  const [inputHistory, setInputHistory] = useState<string[]>([]);                // 输入历史记录（最多 MAX_INPUT_HISTORY 条）
  const [inputInjection, setInputInjection] = useState<{ id: number; text: string } | undefined>(undefined); // 外部注入到输入框的文本
  const [contextPolicy, setContextPolicy] = useState(engine.getContextPolicy()); // 当前上下文策略
  // TUI-FIX-40: Worker 详情面板状态
  const [showWorkerDetail, setShowWorkerDetail] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>();

  // DA-R6: 双角色状态管理
  const [activeRole, setActiveRole] = useState<AgentRole>('worker');

  // DA-R6: Workflow 状态
  const [workflowState, setWorkflowState] = useState<WorkflowState>({
    phase: 'idle',
    iteration: 0,
    maxRounds: 9,
    goal: '',
    supervisorStatus: 'idle',
    workerStatus: 'idle',
  });

  // DA-R6: 检查是否有覆盖层阻止 Tab 切换
  const isOverlayActive = showAutocomplete
    || showModelPicker
    || showSessionPicker
    || showAgentMenu
    || showLangMenu
    || showThinkingMenu
    || showSkillModal
    || showContextModal
    || showHarnessMenu
    || !!bridgeState.permissionPrompt
    || !!bridgeState.questionPrompt;

  useEffect(() => {
    if (persistedAgent) {
      engineRef.current.switchAgent(persistedAgent);
    }
    if (persistedSettings.activeSkills) {
      engineRef.current.setActiveSkills(persistedSettings.activeSkills);
    }
  }, [persistedAgent, persistedSettings.activeSkills]);

  useEffect(() => {
    let cancelled = false;
    void engineRef.current.getContextPolicyAsync().then(policy => {
      if (!cancelled) {
        setContextPolicy(policy);
      }
    });
    return () => { cancelled = true; };
  }, []);

  /** 提交处理：解析用户输入，执行斜杠命令或通过 bridge 发送消息 */
  const handleSubmit = useCallback((text: string) => {
    const submitted = text.trim();
    if (submitted) {
      setInputHistory(prev => [
        submitted,
        ...prev.filter(item => item !== submitted),
      ].slice(0, MAX_INPUT_HISTORY));
    }
    setShowAutocomplete(false);
    const command = parseSlashCommand(submitted);
    if (command?.name === 'exit') {
      exitPending = true;
      engineRef.current.interrupt();
      appendMessage({ role: 'assistant' as const, content: t().shuttingDown });
      cleanupTerminal();
      process.exit(0);
    }
    if (command?.name === 'help') {
      appendMessage({
        role: 'assistant' as const,
        content: buildHelpText(activeAgent, t()),
      });
      return;
    }
    if (command?.name === 'status') {
      void (async () => {
        try {
          const snapshot = await engineRef.current.getStatusSnapshot();
          appendMessage({ role: 'assistant' as const, content: formatStatus(snapshot) });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          appendMessage({ role: 'assistant' as const, content: `Failed to load status: ${msg}` });
        }
      })();
      return;
    }
    if (command?.name === 'model') {
      setShowModelPicker(true);
      return;
    }
    if (command?.name === 'sessions') {
      setShowSessionPicker(true);
      return;
    }
    if (command?.name === 'skill') {
      setShowSkillModal(true);
      return;
    }
    if (command?.name === 'context') {
      setShowContextModal(true);
      return;
    }
    if (command?.name === 'agent') {
      setShowAgentMenu(true);
      return;
    }
    if (command?.name === 'thinking') {
      if (command.mode) {
        const error = validateThinkingMode(command.mode);
        if (error) {
          appendMessage({ role: 'assistant' as const, content: `${error}\nCurrent: ${thinkingMode}` });
          return;
        }
        saveTuiSettings({ thinkingMode: command.mode });
        setThinkingMode(command.mode);
        setBridgeState(prev => ({ ...prev, reasoningActive: false }));
        appendMessage({ role: 'assistant' as const, content: `Thinking mode set to: ${command.mode}` });
        return;
      }
      setShowThinkingMenu(true);
      return;
    }
    if (command?.name === 'lang') {
      setShowLangMenu(true);
      return;
    }
    if (command?.name === 'harness') {
      if (command.subcommand === 'status') {
        appendMessage({
          role: 'assistant' as const,
          content: `Harness strictness: ${harnessStrictness}\nSource: ${harnessSource}`,
        });
        return;
      }
      if (command.subcommand === 'strict' || command.subcommand === 'normal' || command.subcommand === 'loose') {
        setHarnessStrictness(command.subcommand);
        setHarnessSource('session');
        engineRef.current.setHarnessStrictness(command.subcommand);
        appendMessage({
          role: 'assistant' as const,
          content: `Harness strictness set to: ${command.subcommand} (session)\nApplies from: next submission`,
        });
        return;
      }
      if (command.subcommand === 'project') {
        const valid: Array<'strict' | 'normal' | 'loose'> = ['strict', 'normal', 'loose']
        const val = command.arg as 'strict' | 'normal' | 'loose' | undefined
        if (!val || !valid.includes(val)) {
          appendMessage({
            role: 'assistant' as const,
            content: 'Usage: /harness project <strict|normal|loose>',
          });
          return;
        }
        writeProjectHarnessConfig({ strictness: val });
        setHarnessStrictness(val);
        setHarnessSource('project');
        engineRef.current.setHarnessStrictness(val);
        appendMessage({
          role: 'assistant' as const,
          content: `Project default harness strictness set to: ${val}`,
        });
        return;
      }
      setShowHarnessMenu(true);
      return;
    }
    // TUI-FIX-60: /theme 命令 — 列出并切换主题（持久化）
    if (command?.name === 'theme') {
      if (command.themeName) {
        const success = themeManager.setActiveTheme(command.themeName);
        if (success) {
          saveTuiSettings({ theme: command.themeName });
          appendMessage({
            role: 'assistant' as const,
            content: `Theme switched to: ${command.themeName}`,
          });
        } else {
          appendMessage({
            role: 'assistant' as const,
            content: `Unknown theme: ${command.themeName}. Use /theme to list available themes.`,
          });
        }
      } else {
        const themes = themeManager.getAvailableThemes();
        const active = themeManager.getActiveTheme();
        const themeList = themes.map(t =>
          t.name === active.name ? `  * ${t.name} (${t.type})` : `    ${t.name} (${t.type})`
        ).join('\n');
        appendMessage({
          role: 'assistant' as const,
          content: `Available themes:\n${themeList}\n\nActive: ${active.name}\nUsage: /theme <name>`,
        });
      }
      return;
    }
    // DA-R6: /run 命令 — 启动 Workflow（WF-FIX-20: 通过 bridge.runWorkflow）
    if (command?.name === 'run') {
      setWorkflowState({
        phase: 'supervisor_analyse',
        iteration: 1,
        maxRounds: 9,
        goal: command.goal,
        supervisorStatus: 'analyse',
        workerStatus: 'idle',
      });
      appendMessage({
        role: 'assistant' as const,
        content: `Starting workflow for: ${command.goal}\nSupervisor analysing...`,
      });
      scrollRef.current?.scrollToBottom();
      bridge.runWorkflow(command.goal, (phase, iteration) => {
        const phaseMap: Record<string, { supervisor: WorkflowState['supervisorStatus']; worker: WorkflowState['workerStatus'] }> = {
          supervisor_analyse: { supervisor: 'analyse', worker: 'idle' },
          supervisor_check: { supervisor: 'analyse', worker: 'idle' },
          supervisor_intervene: { supervisor: 'analyse', worker: 'do' },
          worker_do: { supervisor: 'analyse', worker: 'do' },
          worker_report: { supervisor: 'waiting', worker: 'report' },
          waiting_user: { supervisor: 'waiting', worker: 'idle' },
          blocked: { supervisor: 'blocked', worker: 'blocked' },
        };
        const mapped = phaseMap[phase] ?? { supervisor: 'idle' as const, worker: 'idle' as const };
        setWorkflowState(prev => ({
          ...prev,
          phase: phase as WorkflowPhase,
          iteration,
          supervisorStatus: mapped.supervisor,
          workerStatus: mapped.worker,
        }));
      });
      return;
    }
    // DA-R6: /talk 命令 — 切换输入目标角色
    if (command?.name === 'talk') {
      if (command.role) {
        setActiveRole(command.role);
        appendMessage({
          role: 'assistant' as const,
          content: `Input target switched to: ${command.role}`,
        });
      } else {
        // Toggle between worker and supervisor
        const newRole = activeRole === 'worker' ? 'supervisor' : 'worker';
        setActiveRole(newRole);
        appendMessage({
          role: 'assistant' as const,
          content: `Input target switched to: ${newRole}`,
        });
      }
      return;
    }
    const taggedSkillNames = extractSkillTags(submitted);
    if (taggedSkillNames.length === 0) {
      scrollRef.current?.scrollToBottom();
      bridge.submit(submitted, false, activeRole);
      return;
    }

    void (async () => {
      const previousSkills = engineRef.current.getActiveSkills();
      const taggedSkills = await loadTaggedSkills(taggedSkillNames);
      const merged = [
        ...previousSkills.filter(skill => !taggedSkills.some(tagged => tagged.name === skill.name)),
        ...taggedSkills,
      ];
      engineRef.current.setActiveSkills(merged);
      scrollRef.current?.scrollToBottom();
      try {
        await bridge.submit(submitted, false, activeRole);
      } finally {
        engineRef.current.setActiveSkills(previousSkills);
      }
    })();
  }, [activeAgent, activeRole, appendMessage, bridge, thinkingMode]);

  /** Agent 切换回调：调用引擎切换 Agent 并更新显示名称 */
  const handleAgentChoose = useCallback((next: string) => {
    const label = engineRef.current.switchAgent(next);
    setActiveAgent(next);
    saveTuiSettings({ agent: next });
    setShowAgentMenu(false);
    appendMessage({ role: 'assistant' as const, content: t().switchedTo(label) });
  }, [appendMessage]);

  /** 语言切换回调：设置界面语言 */
  const handleLangChoose = useCallback((next: string) => {
    setLocale(next as any);
    setShowLangMenu(false);
    appendMessage({ role: 'assistant' as const, content: t().switchedLang(next) });
  }, [appendMessage]);

  /** 推理档位选择回调：更新本地 thinkingMode 并清除 reasoningActive */
  const handleThinkingChoose = useCallback((mode: string) => {
    const error = validateThinkingMode(mode);
    if (error) {
      appendMessage({ role: 'assistant' as const, content: `${error}\nCurrent: ${thinkingMode}` });
      return;
    }
    saveTuiSettings({ thinkingMode: mode });
    setThinkingMode(mode);
    setBridgeState(prev => ({ ...prev, reasoningActive: false }));
    setShowThinkingMenu(false);
    appendMessage({ role: 'assistant' as const, content: `Thinking mode set to: ${mode}` });
  }, [appendMessage, thinkingMode]);

  /** 模型选择回调：更新引擎配置并保存至持久化存储 */
  const handleModelSelect = useCallback((sel: { provider: string; model: string; apiKey: string; baseUrl: string }) => {
    const contextWindow = getModelContextWindow(sel.provider, sel.model);
    engineRef.current.updateConfig({
      provider: sel.provider,
      model: sel.model,
      apiKey: sel.apiKey,
      baseUrl: sel.baseUrl,
      contextWindow,
    });
    setActiveProvider(sel.provider);
    setActiveModel(sel.model);
    saveLastConfig({ provider: sel.provider, model: sel.model, baseUrl: sel.baseUrl });
    setShowModelPicker(false);
    appendMessage({ role: 'assistant' as const, content: t().switchedModel(PROVIDERS[sel.provider]?.label ?? sel.provider, sel.model) });
  }, [appendMessage]);

  /** 模型选择取消回调：关闭选择器覆盖层 */
  const handleModelCancel = useCallback(() => {
    setShowModelPicker(false);
  }, []);

  /** 会话选择回调：加载指定会话的消息并重置 bridge 状态 */
  const handleSessionSelect = useCallback(async (sessionId: string) => {
    setShowSessionPicker(false);
    // Load session messages into the current engine
    const msgs = await engineRef.current.loadSession(sessionId);
    // Guard against post-unmount setState
    if (!mountedRef.current) return;
    // WF-FIX-60: Also load session on supervisor engine for dual-runtime consistency
    if (dualRuntime) {
      dualRuntime.loadSupervisorSession(sessionId).catch(() => {});
    }
    const recoveredTimeline = timelineFromMessages(msgs);
    setBridgeState({
      ...initialState,
      ...(isTranscriptStoreEnabled() ? {} : { timeline: recoveredTimeline }),
    });
    bridgeRef.current.resetBridgeRuntime();
    bridgeRef.current.replaceTranscript(recoveredTimeline);
    // TUI-FIX-20: 重置编排状态
    orchestrationStore.reset();
    appendMessage({ role: 'assistant' as const, content: t().resumedSession(sessionId.slice(0, 8), msgs.length) });
  }, [appendMessage, orchestrationStore, dualRuntime]);

  /** 会话选择取消回调：关闭选择器覆盖层 */
  const handleSessionCancel = useCallback(() => {
    setShowSessionPicker(false);
  }, []);

  /** 权限请求回调：向引擎传递用户的允许/拒绝决策 */
  const handlePermissionSelect = useCallback((reply: 'once' | 'always' | 'reject', message?: string) => {
    bridgeRef.current.respondPermission(reply, message);
  }, []);

  const handleQuestionReply = useCallback((requestId: string, answers: string[][]) => {
    bridgeRef.current.respondQuestion(requestId, answers);
  }, []);

  const handleQuestionReject = useCallback((requestId: string) => {
    bridgeRef.current.rejectQuestion(requestId);
  }, []);

  const providerLabel = getProviderLabel(activeProvider);

  // ---- 覆盖层：模型选择器（当 showModelPicker 为 true 时显示） ----
  if (showModelPicker) {
    return (
      <CenteredStage width={88}>
        <ModelPicker
          currentProvider={activeProvider}
          currentModel={activeModel}
          onSelect={handleModelSelect}
          onCancel={handleModelCancel}
        />
      </CenteredStage>
    );
  }

  // ---- 覆盖层：会话恢复选择器（当 showSessionPicker 为 true 时显示） ----
  if (showSessionPicker) {
    return (
      <CenteredStage width={92}>
        <SessionPicker
          onSelect={handleSessionSelect}
          onCancel={handleSessionCancel}
        />
      </CenteredStage>
    );
  }

  // ---- 覆盖层：Agent 切换菜单（当 showAgentMenu 为 true 时显示） ----
  if (showAgentMenu) {
    const agentItems = defaultAgentRegistry.list().map((a: { name: string; label: string; systemPrompt?: string }) => ({
      value: a.name,
      label: a.label,
      description: a.systemPrompt ? a.systemPrompt.slice(0, 80).replace(/\n/g, " ") : "",
    }))
    if (agentItems.length === 0) {
      agentItems.push(
        { value: "build", label: "Build Agent", description: "完整读写工具" },
        { value: "plan", label: "Plan Agent", description: "只读分析" },
      )
    }
    return (
      <ChoiceMenu
        title="Agent"
        subtitle="选择切换目标"
        items={agentItems}
        onChoose={handleAgentChoose}
        onCancel={() => setShowAgentMenu(false)}
      />
    );
  }

  // ---- 覆盖层：语言切换菜单（当 showLangMenu 为 true 时显示） ----
  if (showLangMenu) {
    return (
      <ChoiceMenu
        title="Language"
        subtitle="选择界面语言"
        items={[
          { value: "zh-CN", label: "中文", description: "切换到中文界面" },
          { value: "en", label: "English", description: "switch to English" },
        ]}
        onChoose={handleLangChoose}
        onCancel={() => setShowLangMenu(false)}
      />
    );
  }

  // ---- 覆盖层：推理档位选择菜单（当 showThinkingMenu 为 true 时显示） ----
  if (showThinkingMenu) {
    return (
      <ChoiceMenu
        title="Thinking"
        subtitle="选择推理档位"
        items={[
          { value: "off", label: "off", description: "disable reasoning" },
          { value: "open", label: "open", description: "enable reasoning" },
          { value: "high", label: "high", description: "strong reasoning (DeepSeek)" },
        ]}
        onChoose={handleThinkingChoose}
        onCancel={() => setShowThinkingMenu(false)}
      />
    );
  }

  // ---- 覆盖层：Harness 严格度选择菜单（当 showHarnessMenu 为 true 时显示） ----
  if (showHarnessMenu) {
    return (
      <ChoiceMenu
        title="Harness strictness"
        subtitle={`Current: ${harnessStrictness} (${harnessSource})\nApplies from: next submission`}
        items={[
          { value: "strict", label: "strict", description: "强约束，适合本地小模型和不稳定工具调用" },
          { value: "normal", label: "normal", description: "默认，在可靠性与自主执行之间平衡" },
          { value: "loose", label: "loose", description: "少干预，保留权限、安全和真实性底线" },
        ]}
        onChoose={(value) => {
          const strictness = value as 'strict' | 'normal' | 'loose';
          setHarnessStrictness(strictness);
          setHarnessSource('session');
          engineRef.current.setHarnessStrictness(strictness);
          setShowHarnessMenu(false);
          appendMessage({
            role: 'assistant' as const,
            content: `Harness strictness set to: ${strictness} (session)\nApplies from: next submission`,
          });
        }}
        onCancel={() => setShowHarnessMenu(false)}
        footer="设为项目默认: /harness project <strict|normal|loose>"
      />
    );
  }

  // ---- 覆盖层：技能管理弹窗（当 showSkillModal 为 true 时显示） ----
  if (showSkillModal) {
    return (
      <SkillModal
        activeSkills={activeSkills}
        onChange={(skills) => {
          setActiveSkills(skills);
          engineRef.current.setActiveSkills(skills);
          saveTuiSettings({ activeSkills: skills });
        }}
        onInsertSkill={(skillName) => {
          const text = `#${skillName} `;
          setInputInjection(prev => ({ id: (prev?.id ?? 0) + 1, text }));
          setInputText(text);
          setShowSkillModal(false);
        }}
        onClose={() => setShowSkillModal(false)}
      />
    );
  }

  // ---- 覆盖层：上下文策略管理弹窗（当 showContextModal 为 true 时显示） ----
  if (showContextModal) {
    return (
      <ContextModal
        policy={contextPolicy}
        loadStatus={() => engineRef.current.getContextPolicyStatus()}
        onPolicyChange={async (policy) => {
          await engineRef.current.setContextPolicy(policy);
          setContextPolicy(engineRef.current.getContextPolicy());
        }}
        onRunReduction={() => engineRef.current.runContextReduction()}
        onClose={() => setShowContextModal(false)}
      />
    );
  }

  // ---- 主内容区（可滚动区域）：消息时间线、搜索结果、欢迎屏、警告/错误提示、权限请求弹窗 ----
  const timelineProp = isTranscriptStoreEnabled() ? undefined : bridgeState.timeline;
  const scrollableContent = (
    <>
      <SearchOverlay
        timeline={timelineProp}
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
      />
      {/* TUI-GM / TUI-FIX-30: 编排概览三栏（Workers / Supervisor / Loop），实时数据 */}
      <OrchestrationSummaryFromStore terminalWidth={process.stdout.columns ?? 80} />
      {/* TUI-FIX-40: Agent 活动组（展开时显示详细进度） */}
      <AgentGroupDisplayFromStore terminalWidth={process.stdout.columns ?? 80} />
      {/* DA-R6: 双角色 Tab 系统 — 简化为输入目标选择器 */}
      <DualTabSystem
        activeRole={activeRole}
        onRoleChange={(role) => {
          // 仅在无覆盖层时允许切换
          if (!isOverlayActive) {
            setActiveRole(role);
          }
        }}
        disabled={isOverlayActive}
        width={process.stdout.columns ?? 80}
      />
      <DeepiMessages
        timeline={timelineProp}
        scrollRef={scrollRef}
      />
      {/* TUI-GM: Loading 指示器（Gemini CLI 风格） */}
      <LoadingIndicator
        streamingState={bridgeSplit ? 'idle' : bridgeState.isLoading ? 'responding' : 'idle'}
      />
      <WelcomeWhenEmpty
        legacyEmpty={bridgeState.timeline.length === 0}
        isLoading={bridgeSplit ? undefined : bridgeState.isLoading}
        error={bridgeSplit ? undefined : bridgeState.error}
      >
        <WelcomeScreen
          model={activeModel}
          provider={providerLabel}
          agent={AGENTS[activeAgent]?.label ?? defaultAgentRegistry.get(activeAgent)?.label ?? activeAgent}
          thinkingMode={thinkingMode}
          contextMode={contextPolicy.mode}
          skillCount={activeSkills.length}
          pluginCount={pluginCount}
          contentPackCount={contentPackCount}
          assetCounts={assetCounts ?? { skills: 0, agents: 0, rules: 0, commands: 0, mcp: 0, hooks: 0 }}
          diagnosticCounts={diagnosticCounts ?? { errors: 0, warnings: 0 }}
        />
      </WelcomeWhenEmpty>
      {/* TUI-FIX-50: DialogManager 集中管理权限和追问弹窗 */}
      <DialogManager
        permissionRequest={bridgeSplit ? null : bridgeState.permissionPrompt}
        questionRequest={bridgeSplit ? null : bridgeState.questionPrompt}
        onPermissionReply={handlePermissionSelect}
        onQuestionReply={handleQuestionReply}
        onQuestionReject={handleQuestionReject}
        terminalWidth={process.stdout.columns ?? 80}
      />
      <BridgeScrollAlerts
        onPermissionSelect={handlePermissionSelect}
        onQuestionReply={handleQuestionReply}
        onQuestionReject={handleQuestionReject}
        legacy={bridgeSplit ? undefined : {
          warnings: bridgeState.warnings,
          error: bridgeState.error,
          permissionPrompt: null,  // handled by DialogManager
          questionPrompt: null,    // handled by DialogManager
        }}
      />
    </>
  );

  // ---- 底部区域（固定定位）：Workflow 状态栏、命令自动补全、输入框、状态栏 ----
  const bottomContent = (
    <Box flexDirection="column" width="100%">
      {/* DA-R6: Workflow 状态栏 - 固定在输入框正上方 */}
      <WorkflowStatusBar
        workflow={workflowState}
        activeRole={activeRole}
        width={process.stdout.columns ?? 80}
      />
      {showAutocomplete && (
        <CommandAutocomplete
          query={inputText}
          onSubmit={(cmd) => {
            promptInputRef.current?.writeText('');
            setInputText('');
            setShowAutocomplete(false);
            handleSubmit(cmd);
          }}
          onComplete={(cmd) => {
            promptInputRef.current?.writeText(cmd + ' ');
            setShowAutocomplete(false);
          }}
          onClose={() => setShowAutocomplete(false)}
        />
      )}
      <BridgeDeepiPromptInput
        ref={promptInputRef}
        onSubmit={handleSubmit}
        history={inputHistory}
        injectedText={inputInjection}
        onChange={(text) => {
          setInputText(text);
          setShowAutocomplete(text.startsWith('/') && !text.includes(' '));
        }}
        onCancel={handleCancel}
        suppressHistory={showAutocomplete}
        suppressSubmit={showAutocomplete}
        legacy={bridgeSplit ? undefined : {
          isLoading: bridgeState.isLoading,
          disabled: !!bridgeState.permissionPrompt || !!bridgeState.questionPrompt,
          queueCount: bridgeState.messageQueue.length,
        }}
      />
      <BridgeStatusBar
        model={activeModel}
        provider={providerLabel}
        agent={AGENTS[activeAgent]?.label ?? defaultAgentRegistry.get(activeAgent)?.label ?? activeAgent}
        contextTotal={contextTotal}
        statusMessage={statusMessage}
        thinkingMode={thinkingMode}
        cwd={process.cwd()}
        legacy={bridgeSplit ? undefined : {
          inputTokens: bridgeState.tokens.input,
          outputTokens: bridgeState.tokens.output,
          cacheHitTokens: bridgeState.tokens.cacheHit,
          cacheMissTokens: bridgeState.tokens.cacheMiss,
          contextUsed: bridgeState.contextUsage,
          pendingInstructionCount: bridgeState.pendingInstructionCount,
          reasoningActive: bridgeState.reasoningActive,
        }}
      />
    </Box>
  );

  if (isFullscreenEnvEnabled()) {
    return (
      <BridgeRuntimeProvider runtime={bridgeRuntime}>
        <TranscriptProvider reader={transcriptReader}>
          <OrchestrationStoreProvider store={orchestrationStore}>
          {/* Alternate Screen 没有原生 scrollback；鼠标跟踪用于驱动消息区 ScrollBox。 */}
          <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
            <FullscreenLayout
              scrollRef={scrollRef}
              scrollable={scrollableContent}
              bottom={bottomContent}
            />
          </AlternateScreen>
          </OrchestrationStoreProvider>
        </TranscriptProvider>
      </BridgeRuntimeProvider>
    );
  }

  return (
    <BridgeRuntimeProvider runtime={bridgeRuntime}>
      <TranscriptProvider reader={transcriptReader}>
        <OrchestrationStoreProvider store={orchestrationStore}>
        {scrollableContent}
        {bottomContent}
        </OrchestrationStoreProvider>
      </TranscriptProvider>
    </BridgeRuntimeProvider>
  );
}
