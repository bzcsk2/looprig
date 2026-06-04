/**
 * PermissionPrompt — 工具执行权限确认弹窗
 *
 * 功能：当 AI 助手请求执行工具（如 Bash、文件读写等）时，弹出此弹窗让用户确认或拒绝。
 * 提供三个选项：允许 (allow)、始终允许 (always allow)、拒绝 (deny)。
 * 支持键盘上下键切换选项、回车确认、Esc 默认拒绝。
 *
 * @param toolName - 请求执行的工具名称（如 'bash', 'Read' 等）
 * @param args - 工具调用的参数，用于展示给用户确认
 * @param onSelect - 用户选择后的回调，(allow, alwaysAllow?) => void
 */
import { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { t } from './i18n/index.js';

interface PermissionPromptProps {
  toolName: string;
  args: Record<string, unknown>;
  onSelect: (allow: boolean, alwaysAllow?: boolean) => void;
}

/** getOptions — 返回三个选项及其 i18n 标签 */
function getOptions() {
  return [
    { label: t().allow, value: 'allow' as const },
    { label: t().alwaysAllow, value: 'always' as const },
    { label: t().deny, value: 'deny' as const },
  ];
}

/**
 * formatArgs — 将工具参数格式化为便于阅读的字符串
 * - Bash/Shell 类工具：直接展示命令原文
 * - 带 path 参数的工具：展示路径
 * - 参数少（≤2 个）时展示 k=v 格式
 * - 参数多时展示参数数量
 */
function formatArgs(toolName: string, args: Record<string, unknown>): string {
  const name = toolName.toLowerCase();
  if (name === 'bash' || name === 'shell' || name === 'shell_exec') {
    const cmd = args.command ?? args.cmd ?? '';
    return typeof cmd === 'string' ? cmd : JSON.stringify(cmd);
  }
  if (args.path) return String(args.path);
  if (args.command) return String(args.command);
  const keys = Object.keys(args);
  if (keys.length <= 2) return keys.map(k => `${k}=${JSON.stringify(args[k])}`).join(' ');
  return t().parameters(keys.length);
}

export function PermissionPrompt({ toolName, args, onSelect }: PermissionPromptProps) {
  /** 当前选中的选项索引（0=allow, 1=always, 2=deny） */
  const [selected, setSelected] = useState(0);
  /** alive 标记组件是否仍挂载，防止 unmount 后回调执行导致状态泄漏 */
  const alive = useRef(true);
  const options = getOptions();

  useEffect(() => { return () => { alive.current = false; }; }, []);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelected(prev => (prev - 1 + options.length) % options.length);
    } else if (key.downArrow) {
      setSelected(prev => (prev + 1) % options.length);
    } else if (key.return) {
      const opt = options[selected];
      if (!alive.current) return;
      if (opt.value === 'allow') onSelect(true);
      else if (opt.value === 'always') onSelect(true, true);
      else onSelect(false);
    } else if (key.escape) {
      if (alive.current) onSelect(false);
    }
  });

  const cmd = formatArgs(toolName, args);

  return (
    // 主容器：纵向排列，宽度 100%，圆角边框，边框颜色 warning（黄色/警告色），内外间距各 1
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor="warning" paddingX={1} paddingY={1} marginBottom={1}>
      <Box marginBottom={1}>
        {/* bold 粗体标题，warning 色突出权限提醒，🔐 为视觉图标提醒用户注意安全 */}
        <Text bold color="warning">{`🔐 ${t().permissionTitle}`}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>
          <Text bold>{toolName}</Text>
          <Text>{t().requestsToExecute}</Text>
        </Text>
      </Box>
      <Box paddingLeft={1} marginBottom={1}>
        {/* warning 色展示待执行的命令，与普通文字区分 */}
        <Text color="warning">$ {cmd}</Text>
      </Box>
      {options.map((opt, i) => (
        <Box key={opt.value} paddingLeft={1}>
          {/* 选中项用 warning 色高亮文字，▸ 为选中指示符；未选中项以默认颜色 + 空格占位 */}
          <Text color={i === selected ? 'warning' : undefined}>
            {i === selected ? '▸ ' : '  '}
          </Text>
          <Text bold={i === selected} color={i === selected ? 'warning' : undefined}>
            {opt.label}
          </Text>
        </Box>
      ))}
      <Box marginTop={1} paddingLeft={1}>
        {/* dimColor 表示底部操作提示，降低视觉权重 */}
        <Text dimColor>{t().permissionHint}</Text>
      </Box>
    </Box>
  );
}
