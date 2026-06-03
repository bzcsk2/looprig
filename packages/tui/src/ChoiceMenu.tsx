import { useState, type ReactElement } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { ModalShell } from './ModalShell.js';
import { FG, TONE } from './reasonix/tokens.js';

/**
 * ChoiceMenu 组件 - 选项菜单弹窗
 *
 * 【组件职责】
 * 提供简单的单选菜单界面，用于：
 * - Agent 切换（build/plan）
 * - 语言切换（中文/English）
 * - 思考模式选择（off/low/medium/high/max）
 *
 * 【Props 说明】
 * - title: 菜单标题
 * - subtitle: 副标题（可选）
 * - items: 选项数组，每项包含 value/label/description
 * - onChoose: 选择回调，传入选中项的 value
 * - onCancel: 取消回调
 * - footer: 底部提示文字（可选，默认显示操作提示）
 *
 * 【交互逻辑】
 * - ↑/↓: 上下移动选择
 * - Enter: 确认选择
 * - Esc/Ctrl+C: 取消关闭
 *
 * 【显示参数】
 * 以下参数控制菜单的视觉样式
 */

export interface ChoiceItem {
  value: string;
  label: string;
  description?: string;
}

interface ChoiceMenuProps {
  title: string;
  subtitle?: string;
  items: ChoiceItem[];
  onChoose: (value: string) => void;
  onCancel: () => void;
  footer?: string;
}

/**
 * 选项菜单组件
 *
 * 状态管理：
 * - selectedIdx: 当前选中项索引（0 ~ items.length-1）
 *
 * 键盘处理：
 * - Escape/Ctrl+C: 触发 onCancel
 * - UpArrow: 选中索引 -1（循环到末尾）
 * - DownArrow: 选中索引 +1（循环到开头）
 * - Enter: 触发 onChoose(selectedValue)
 *
 * 视觉样式：
 * - 选中项：品牌色（TONE.brand）+ 加粗 + ❯ 前缀
 * - 未选中项：正文色（FG.body）+ 空格前缀
 * - 描述文字：淡色（FG.faint）
 *
 * @param props - ChoiceMenuProps
 * @returns 渲染后的菜单元素
 */
export function ChoiceMenu({ title, subtitle, items, onChoose, onCancel, footer }: ChoiceMenuProps): ReactElement {
  // 内部状态：当前选中索引
  const [selectedIdx, setSelectedIdx] = useState(0);

  // 键盘输入处理
  useInput((_input, key) => {
    // Escape 或 Ctrl+C：取消
    if (key.escape || (key.ctrl && _input === 'c')) {
      onCancel();
      return;
    }

    // 空列表时不处理方向键
    if (items.length === 0) return;

    // 上箭头：向上移动（循环）
    if (key.upArrow) {
      setSelectedIdx(prev => (prev - 1 + items.length) % items.length);
      return;
    }

    // 下箭头：向下移动（循环）
    if (key.downArrow) {
      setSelectedIdx(prev => (prev + 1) % items.length);
      return;
    }

    // Enter：确认选择
    if (key.return) {
      const item = items[selectedIdx];
      if (item) onChoose(item.value);
    }
  });

  return (
    <ModalShell title={title} subtitle={subtitle} onCancel={onCancel}>
      {/* 显示参数：gap={1} 控制选项之间的垂直间距 */}
      <Box flexDirection="column" gap={1}>
        {/* 选项列表 */}
        {items.map((item, i) => (
          <Box key={item.value} flexDirection="row">
            {/* 选中指示器：选中时显示 ❯ 和品牌色，否则显示空格 */}
            <Text color={i === selectedIdx ? TONE.brand : FG.faint}>{i === selectedIdx ? '❯ ' : '  '}</Text>
            {/* 选项标签：选中时加粗和品牌色 */}
            <Text bold={i === selectedIdx} color={i === selectedIdx ? TONE.brand : FG.body}>
              {item.label}
            </Text>
            {/* 选项描述（如有） */}
            {item.description ? <Text color={FG.faint}> {item.description}</Text> : null}
          </Box>
        ))}

        {/* 底部提示 */}
        <Box marginTop={1}>
          <Text dimColor>{footer ?? '↑↓ 选择 · Enter 确认 · Esc 关闭'}</Text>
        </Box>
      </Box>
    </ModalShell>
  );
}
