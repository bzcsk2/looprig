import React, { useState, useEffect } from 'react';
import { Box, Text } from '@covalo/ink';

// 10 帧 Braille 点旋转动画序列，逐帧形成旋转视觉
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// 帧切换间隔（毫秒），80ms ≈ 12.5 帧/秒
const INTERVAL_MS = 80;

/**
 * Spinner - 加载旋转指示器组件
 *
 * 功能：在加载过程中显示 Braille 点字符旋转动画。
 * 当 loading=false 时隐藏，不会占用 UI 空间。
 *
 * Props：
 * - loading: 是否正在加载中；true 时启动动画，false 时隐藏
 * - message: 可选的加载提示文字，显示在旋转器右侧
 *
 * 内部状态：
 * - frame: 当前动画帧索引，由定时器循环更新（0~9），每秒约更新 12.5 帧
 *
 * 显示参数：
 * - FRAMES: 10 帧 Braille 旋转动画序列（'⠋', '⠙', ..., '⠏'）
 * - INTERVAL_MS: 帧切换间隔 80ms，决定旋转速度
 * - color: 使用主题颜色 "success" 绿色渲染
 * - paddingX: 水平内边距为 1
 */
interface SpinnerProps {
  loading: boolean;
  message?: string;
}

export function Spinner({ loading, message }: SpinnerProps) {
  // 当前动画帧索引，0~9
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!loading) {
      // loading 结束：重置帧为 0，清除动画
      setFrame(0);
      return;
    }
    // loading 开始：启动定时器，逐帧切换，循环播放
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % FRAMES.length);
    }, INTERVAL_MS);
    // 清理函数：组件卸载或 loading 变化时清除定时器
    return () => clearInterval(timer);
  }, [loading]);

  // loading=false 时完全不渲染，不占用 UI 空间
  if (!loading) return null;

  return (
    <Box paddingX={1}>
      <Text color="success">{FRAMES[frame]}</Text>
      {message && <Text> {message}</Text>}
    </Box>
  );
}
