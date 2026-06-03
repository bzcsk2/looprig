import React from 'react';
import { Box, Dialog, useTerminalSize } from '@deepicode/ink';
import { TONE, SURFACE } from './reasonix/tokens.js';

/**
 * ModalShell 组件 - 模态框外壳
 *
 * 【组件职责】
 * 为各种模态对话框（ModelPicker、SessionPicker、SkillModal 等）
 * 提供统一的居中定位和边框样式。
 *
 * 【Props 说明】
 * - title: 弹窗标题（ReactNode，支持复杂内容）
 * - subtitle: 副标题（可选）
 * - onCancel: 取消/关闭回调
 * - children: 弹窗主体内容
 * - width: 弹窗宽度（默认 76 字符），会根据终端大小自动调整
 *
 * 【显示参数】
 * 以下参数控制模态框的视觉样式：
 */

interface ModalShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onCancel: () => void;
  children: React.ReactNode;
  width?: number;
}

/**
 * 模态框外壳组件
 *
 * 布局计算：
 * 1. 获取终端尺寸
 * 2. 计算实际宽度：min(期望宽度, 终端宽度-8)，且不小于 44
 * 3. 使用全屏 Flex 布局居中
 *
 * 视觉样式：
 * - 圆角边框（borderStyle: "round"）
 * - 品牌色边框（borderColor: TONE.brand）
 * - 深色背景（backgroundColor: SURFACE.bg）
 * - 内边距：水平 1 字符，垂直 1 行
 *
 * @param props - ModalShellProps
 * @returns 渲染后的模态框外壳
 */
export function ModalShell({ title, subtitle, onCancel, children, width = 76 }: ModalShellProps): React.ReactElement {
  // 获取终端尺寸用于响应式计算
  const { rows, columns } = useTerminalSize();

  // 显示参数：计算实际弹窗宽度
  // 终端宽度减去 8 字符边距，但不超过期望宽度，且不小于 44
  const modalWidth = Math.max(44, Math.min(width, columns - 8));

  return (
    // 外层容器：占满整个终端，使用 Flex 居中
    <Box width="100%" height={rows} flexDirection="column" justifyContent="center" alignItems="center">
      {/* 显示参数：边框样式 */}
      {/* borderStyle="round": 圆角边框 */}
      {/* borderColor={TONE.brand}: 使用品牌色（绿色）边框 */}
      {/* backgroundColor={SURFACE.bg}: 使用主背景色 */}
      {/* paddingX={1}, paddingY={1}: 内边距 1 字符/行 */}
      <Box
        width={modalWidth}
        flexDirection="column"
        borderStyle="round"
        borderColor={TONE.brand}
        backgroundColor={SURFACE.bg}
        paddingX={1}
        paddingY={1}
      >
        {/* Dialog 组件：处理标题和取消操作 */}
        {/* hideBorder: 隐藏 Dialog 自带边框（我们已在外层设置） */}
        {/* hideInputGuide: 隐藏输入提示 */}
        <Dialog title={title} subtitle={subtitle} onCancel={onCancel} hideBorder hideInputGuide>
          {children}
        </Dialog>
      </Box>
    </Box>
  );
}
