/**
 * CardHeader — 卡片头部信息栏
 * 显示卡片的图标(glyph)、标题(title)、副标题(subtitle)、元数据标签(meta)和右侧区域(right)。
 * 输入参数：
 *   - glyph: string，左侧图标符号（如 • ▶ ▼ ✓ ✗ 等），color 由 tone 控制
 *   - tone: string，标题和图标的颜色 token（如 TONE.ok / TONE.err / TONE.brand）
 *   - title: string，卡片标题，以粗体渲染
 *   - subtitle?: string，副标题，使用 FG.body 颜色
 *   - meta?: MetaItem[]，元数据标签数组，每项可以是纯文本（默认色）或含自定义颜色的对象
 *   - right?: React.ReactNode，右侧区域（如 Spinner、速率信息等）
 * 布局说明：
 *   - flexDirection="row" — 水平排列所有元素
 *   - gap={1} — 元素间等间距
 * 渲染方式：
 *   - meta 元素之间用中间点(·)分隔
 *   - right 内容紧跟在 meta 之后，由调用方传入
 */
import { Box, Text } from '@deepicode/ink';
import React from 'react';
import { FG } from './tokens.js';

export type MetaItem = string | { text: string; color: string };

export interface CardHeaderProps {
  glyph: string;
  tone: string;
  title: string;
  subtitle?: string;
  meta?: ReadonlyArray<MetaItem>;
  right?: React.ReactNode;
}

export function CardHeader({ glyph, tone, title, subtitle, meta, right }: CardHeaderProps): React.ReactElement {
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={tone as any}>{glyph}</Text>
      <Text bold color={tone as any}>{title}</Text>
      {subtitle ? <Text color={FG.body}>{subtitle}</Text> : null}
      {meta?.map((item, i) => {
        const isStr = typeof item === 'string';
        const text = isStr ? item : item.text;
        const color = isStr ? FG.faint : item.color;
        return (
          <React.Fragment key={`m-${i}`}>
            <Text color={FG.faint}>{'\u00B7'}</Text>
            <Text color={color}>{text}</Text>
          </React.Fragment>
        );
      })}
      {right}
    </Box>
  );
}
