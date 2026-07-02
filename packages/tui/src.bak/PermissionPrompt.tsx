import { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from '@covalo/ink';

interface PermissionPromptProps {
  toolName: string;
  args: Record<string, unknown>;
  onSelect: (allow: boolean, alwaysAllow?: boolean) => void;
}

const OPTIONS = [
  { label: '允许', value: 'allow' as const },
  { label: '始终允许', value: 'always' as const },
  { label: '拒绝', value: 'deny' as const },
];

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
  return `${keys.length} parameters`;
}

export function PermissionPrompt({ toolName, args, onSelect }: PermissionPromptProps) {
  const [selected, setSelected] = useState(0);
  const alive = useRef(true);

  useEffect(() => { return () => { alive.current = false; }; }, []);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelected(prev => (prev - 1 + OPTIONS.length) % OPTIONS.length);
    } else if (key.downArrow) {
      setSelected(prev => (prev + 1) % OPTIONS.length);
    } else if (key.return) {
      const opt = OPTIONS[selected];
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
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor="warning" paddingX={1} paddingY={1} marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color="warning">🔐 权限确认</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>
          <Text bold>{toolName}</Text>
          <Text> 请求执行：</Text>
        </Text>
      </Box>
      <Box paddingLeft={1} marginBottom={1}>
        <Text color="warning">$ {cmd}</Text>
      </Box>
      {OPTIONS.map((opt, i) => (
        <Box key={opt.value} paddingLeft={1}>
          <Text color={i === selected ? 'warning' : undefined}>
            {i === selected ? '▸ ' : '  '}
          </Text>
          <Text bold={i === selected} color={i === selected ? 'warning' : undefined}>
            {opt.label}
          </Text>
        </Box>
      ))}
      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>↑↓ 选择 · Enter 确认 · Esc 拒绝</Text>
      </Box>
    </Box>
  );
}
