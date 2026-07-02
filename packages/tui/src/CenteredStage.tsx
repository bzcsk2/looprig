import type { ReactNode, ReactElement } from 'react';
import { Box, useTerminalSize } from '@covalo/ink';

/**
 * CenteredStage 组件 - 居中弹窗/模态框容器
 *
 * 【组件职责】
 * 为模态对话框（如 ModelPicker、SessionPicker）提供居中定位的容器。
 * 自动计算位置，确保弹窗在终端窗口中水平和垂直居中。
 *
 * 【Props 说明】
 * - children: 弹窗内容
 * - width: 弹窗期望宽度（默认 84 字符）
 *   实际宽度会根据终端大小自动调整
 *
 * 【显示参数】
 * - width: 84 - 默认弹窗宽度（字符数）
 *   调大：弹窗更宽，适合内容较多的场景
 *   调小：弹窗更紧凑
 *   建议范围: 60 ~ 100
 * - minWidth: 44 - 最小宽度限制，确保再小的终端也能正常显示
 */
interface CenteredStageProps {
  children: ReactNode;
  width?: number;
}

/**
 * 居中舞台容器
 *
 * 布局计算逻辑：
 * 1. 获取终端尺寸（rows, columns）
 * 2. 计算实际舞台宽度：取 min(期望宽度, 终端宽度-8)
 * 3. 确保不小于最小宽度 44
 * 4. 使用 Flex 布局居中显示
 *
 * @param props - CenteredStageProps
 * @returns 渲染后的居中容器
 */
export function CenteredStage({ children, width = 84 }: CenteredStageProps): ReactElement {
  // 获取当前终端尺寸
  const { rows, columns } = useTerminalSize();

  // 显示参数：计算实际宽度
  // 终端宽度减去 8 字符边距，但不超过期望宽度，且不小于 44
  const stageWidth = Math.max(44, Math.min(width, columns - 8));

  return (
    // 外层容器：占满整个终端，使用 Flex 居中
    <Box width="100%" height={rows} flexDirection="column" justifyContent="center" alignItems="center">
      {/* 内层容器：固定宽度，内容垂直排列 */}
      <Box width={stageWidth} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
