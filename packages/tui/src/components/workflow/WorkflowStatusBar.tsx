/**
 * WorkflowStatusBar — Workflow 状态栏组件
 *
 * 固定布局：
 * - 第一行：DeepReef + Workflow 阶段链 + loops
 * - 第二行：Supervisor | Worker | goal 三段卡片
 *
 * 阶段标识：[D] analyse 表示 DeepReef 调度 Supervisor 分析；[W] do/report 表示 Worker 实施和报告
 */

import { Box, Text } from '@deepreef/ink';
import { FG, TONE } from '../../reasonix/tokens.js';

/** Workflow 阶段类型 */
export type WorkflowPhase =
  | 'idle'
  | 'supervisor_analyse'
  | 'worker_do'
  | 'worker_report'
  | 'supervisor_check'
  | 'continue'
  | 'revise'
  | 'approve'
  | 'blocked'
  | 'ask_user';

/** Workflow 状态 */
export interface WorkflowState {
  phase: WorkflowPhase;
  iteration: number;
  maxRounds: number;
  goal: string;
  supervisorStatus: 'idle' | 'analyse' | 'waiting' | 'blocked';
  workerStatus: 'idle' | 'do' | 'report' | 'waiting' | 'blocked';
}

/** WorkflowStatusBar 属性 */
export interface WorkflowStatusBarProps {
  workflow: WorkflowState;
  activeRole?: 'worker' | 'supervisor';
  /** 当前工作流模式：alone（单 agent）/ subagent（supervisor 自主调度）/ loop（固定双角色编排） */
  workflowMode?: 'alone' | 'subagent' | 'loop';
  width?: number;
}

/** 阶段显示映射 */
const PHASE_DISPLAY: Record<WorkflowPhase, { label: string; prefix: string; color: string }> = {
  idle: { label: 'idle', prefix: '', color: FG.faint },
  supervisor_analyse: { label: 'analyse', prefix: '[D]', color: TONE.brand },
  worker_do: { label: 'do', prefix: '[W]', color: TONE.ok },
  worker_report: { label: 'report', prefix: '[W]', color: TONE.ok },
  supervisor_check: { label: 'check', prefix: '[D]', color: TONE.brand },
  continue: { label: 'continue', prefix: '[D]', color: TONE.brand },
  revise: { label: 'revise', prefix: '[D]', color: TONE.warn },
  approve: { label: 'approve', prefix: '[D]', color: TONE.ok },
  blocked: { label: 'blocked', prefix: '[D]', color: TONE.error },
  ask_user: { label: 'ask_user', prefix: '[D]', color: TONE.warn },
};

/** 角色状态显示映射 */
const ROLE_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  idle: { label: 'idle', color: FG.faint },
  analyse: { label: 'analyse', color: TONE.brand },
  do: { label: 'do', color: TONE.ok },
  report: { label: 'report', color: TONE.ok },
  waiting: { label: 'wait', color: FG.sub },
  blocked: { label: 'blocked', color: TONE.error },
};

/**
 * 截断文本到指定宽度
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 3) + '...';
}

/**
 * WorkflowStatusBar 组件
 */
export function WorkflowStatusBar({
  workflow,
  activeRole,
  workflowMode = 'alone',
  width = 80,
}: WorkflowStatusBarProps) {
  const { phase, goal, supervisorStatus, workerStatus } = workflow;

  // 当前工作流模式显示（替代原 loops 计数）
  const MODE_DISPLAY: Record<string, { label: string; color: string }> = {
    alone: { label: 'alone', color: FG.faint },
    subagent: { label: 'subagent', color: TONE.accent },
    loop: { label: 'loop', color: TONE.brand },
  };
  const modeDisplay = MODE_DISPLAY[workflowMode] ?? MODE_DISPLAY.alone;

  // 第二行：Supervisor | Worker | goal 三段卡片
  const supervisorDisplay = ROLE_STATUS_DISPLAY[supervisorStatus] ?? ROLE_STATUS_DISPLAY.idle;
  const workerDisplay = ROLE_STATUS_DISPLAY[workerStatus] ?? ROLE_STATUS_DISPLAY.idle;

  // 计算可用宽度
  const goalMaxWidth = Math.max(10, width - 40);

  return (
    <Box width="100%" flexDirection="row" paddingX={1}>
      <Text color={FG.faint}>{' | '}</Text>
      <Text bold color={modeDisplay.color as any}>{modeDisplay.label}</Text>
      <Text color={FG.faint}>{' | '}</Text>

      <Box flexDirection="row" alignItems="center">
        <Text color={FG.faint}>Supervisor</Text>
        <Box
          backgroundColor={activeRole === 'supervisor' ? TONE.brand : FG.faint}
          paddingX={1}
        >
          <Text
            bold={activeRole === 'supervisor'}
            color={activeRole === 'supervisor' ? '#000' : supervisorDisplay.color as any}
          >
            {supervisorDisplay.label}
          </Text>
        </Box>
      </Box>

      <Text color={FG.faint}>{' | '}</Text>

      <Box flexDirection="row" alignItems="center">
        <Text color={FG.faint}>Worker</Text>
        <Box
          backgroundColor={activeRole === 'worker' ? TONE.ok : FG.faint}
          paddingX={1}
        >
          <Text
            bold={activeRole === 'worker'}
            color={activeRole === 'worker' ? '#000' : workerDisplay.color as any}
          >
            {workerDisplay.label}
          </Text>
        </Box>
      </Box>

      <Text color={FG.faint}>{' | '}</Text>

      <Box flexGrow={1}>
        <Text color={FG.sub}>
          goal: {truncateText(goal, goalMaxWidth)}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * 构建阶段链字符串
 */
function buildPhaseChain(currentPhase: WorkflowPhase): string {
  const phases: Array<{ key: WorkflowPhase; label: string; prefix: string }> = [
    { key: 'supervisor_analyse', label: 'analyse', prefix: '[D]' },
    { key: 'worker_do', label: 'do', prefix: '[W]' },
    { key: 'worker_report', label: 'report', prefix: '[W]' },
    { key: 'supervisor_check', label: 'check', prefix: '[D]' },
  ];

  const parts: string[] = [];
  for (const p of phases) {
    if (p.key === currentPhase) {
      parts.push(`${p.prefix} ${p.label}`);
      break;
    } else {
      parts.push(`${p.prefix} ${p.label}`);
    }
  }

  if (!parts.includes(`${PHASE_DISPLAY[currentPhase]?.prefix} ${PHASE_DISPLAY[currentPhase]?.label}`)) {
    const display = PHASE_DISPLAY[currentPhase];
    if (display && currentPhase !== 'idle') {
      parts.push(`${display.prefix} ${display.label}`);
    }
  }

  return parts.join(' > ');
}
