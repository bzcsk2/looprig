import { Box, Text, useAnimationFrame } from '@covalo/ink';
import React from 'react';

// 动画帧序列定义
// circle: 4帧半圆旋转（◐◓◑◒）
// braille: 8帧 Braille 点旋转（⠋⠙⠹⠸⠼⠴⠦⠧）
const FRAMES = {
  circle: ['\u25D0', '\u25D3', '\u25D1', '\u25D2'] as const,
  braille: ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827'] as const,
};

/**
 * Spinner (reasonix) - 高性能旋转指示器组件
 *
 * 功能：使用 useAnimationFrame 驱动的帧动画旋转器，提供比 setInterval
 * 更流畅的动画效果，与 Ink 渲染周期同步。
 *
 * Props：
 * - kind: 动画样式，"circle"（半圆旋转，4帧）或 "braille"（Braille 点旋转，8帧）
 * - color: 文字颜色，传入主题 token 值（如 FG.strong、TONE.accent 等），
 *   内部通过 as any 转换以兼容 Ink 类型
 * - bold: 是否加粗渲染
 *
 * 显示参数：
 * - color: 文字颜色（使用主题 token，如 FG.strong, TONE.accent 等）
 * - bold: 是否加粗显示
 * - 动画帧间隔 120ms，由 useAnimationFrame 驱动
 * - 两种帧序列：circle 4帧 / braille 8帧
 */
export interface SpinnerProps { kind?: keyof typeof FRAMES; color?: string; bold?: boolean; }

export function Spinner({ kind = 'circle', color, bold }: SpinnerProps): React.ReactElement {
  const frames = FRAMES[kind];
  // useAnimationFrame(120): 每 120ms 触发一次渲染，与 Ink 帧同步
  const [ref, time] = useAnimationFrame(120);
  // 根据累计时间计算当前帧索引，自动循环
  const frame = Math.floor(time / 120) % frames.length;
  return <Box ref={ref}><Text bold={bold} color={color as any}>{frames[frame]}</Text></Box>;
}
