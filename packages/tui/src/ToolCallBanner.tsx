/**
 * ToolCallBanner — 顶部工具调用状态横幅
 * 在输入栏上方显示当前正在运行或已完成的工具调用列表。
 * 输入参数：
 *   - activeTools: Map<string, ToolStatus>，工具状态集合
 *     键为工具唯一标识，值为包含名称(name)、状态(status: running/done/error)和输出(output)等信息
 * 视觉说明：
 *   - running: 橘色⏺图标 — 工具正在执行
 *   - done: 绿色✓图标 — 工具执行成功
 *   - error: 红色✗图标 — 工具执行出错
 *   - 已完成且非空的输出会截取前 80 字符预览
 */
import React from 'react';
import { Box, Text } from '@covalo/ink';
import type { ToolStatus } from './bridge.js';

interface ToolCallBannerProps {
  activeTools: Map<string, ToolStatus>;
}

export function ToolCallBanner({ activeTools }: ToolCallBannerProps) {
  // 没有活跃工具时不渲染任何内容
  if (activeTools.size === 0) return null;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {Array.from(activeTools.entries()).map(([key, tool]) => {
        const icon = tool.status === 'running' ? '⏺' : tool.status === 'done' ? '✓' : '✗';
        const color = tool.status === 'running' ? 'warning' : tool.status === 'done' ? 'success' : 'error' as const;
        return (
          <Box key={key}>
            <Text color={color}>{icon}</Text>
            <Text> [{tool.name}]</Text>
            {/* 仅对 done 状态的工具显示输出摘要，避免 running 状态下截断不完整输出 */}
            {tool.status === 'done' && tool.output && (
              <Text dimColor> → {tool.output.slice(0, 80)}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
