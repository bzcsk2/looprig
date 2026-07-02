/**
 * Card — 卡片容器组件
 * 提供统一的卡片样式容器，用于包裹各类消息卡片（消息、工具调用、流式输出等）。
 * 输入参数：
 *   - tone?: string，卡片的主题色 token（如 TONE.ok / TONE.err），当前实现中预留但未直接使用
 *     子组件（如 CardHeader）可接收此值以统一配色
 *   - children: React.ReactNode，卡片内容
 * 布局说明：
 *   - flexDirection="column" — 纵向排列子元素
 *   - marginTop={1} — 卡片之间保持 1 个单位的上边距
 *   - width="100%" — 宽度撑满父容器
 */
import { Box } from '@covalo/ink';
import React from 'react';
import { SURFACE } from './tokens.js';

export interface CardProps { tone?: string; children: React.ReactNode; }

export function Card({ children }: CardProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} width="100%">
      {children}
    </Box>
  );
}

/** PanelCard — 面板风格的卡片容器，带深色背景 */
export function PanelCard({ children }: CardProps): React.ReactElement {
  return (
    <Box flexDirection="column" width="100%" backgroundColor={SURFACE.bgElev}>
      {children}
    </Box>
  );
}
