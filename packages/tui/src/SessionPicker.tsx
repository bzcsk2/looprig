/**
 * SessionPicker — 历史会话选择弹窗
 *
 * 功能：列出所有历史会话记录，供用户选择恢复。首次挂载时从 SessionLoader 异步加载列表。
 * 支持键盘上下键导航选择、回车确认、Esc 取消。
 * 三种状态同步展示：加载中、加载失败（错误信息）、列表为空（提示）。
 *
 * @param onSelect - 用户选定会话后的回调，传入 sessionId
 * @param onCancel - 用户取消时的回调
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from '@covalo/ink';
import { SessionLoader, type SessionSummary } from '@covalo/core';
import { t } from './i18n/index.js';

interface SessionPickerProps {
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

/**
 * fmtTime — 将时间戳格式化为 "YYYY-MM-DD HH:mm" 可读字符串
 * @param ts - Unix 毫秒时间戳
 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * fmtTokens — 将 Token 数量格式化为可读形式
 * 规则：≥1M 显示 "X.XM"，≥1K 显示 "XK"，否则原样显示
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function SessionPicker({ onSelect, onCancel }: SessionPickerProps) {
  /** 从 SessionLoader 加载的会话列表 */
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  /** 当前选中的会话索引 */
  const [selIdx, setSelIdx] = useState(0);
  /** 是否还在加载中 */
  const [loading, setLoading] = useState(true);
  /** 加载出错时的错误信息，null 表示无错误 */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    SessionLoader.list().then(s => {
      setSessions(s);
      setLoading(false);
    }).catch(e => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, []);

  const confirm = useCallback(() => {
    const s = sessions[selIdx];
    if (!s) return; // session list empty or selIdx out of bounds
    onSelect(s.id);
  }, [sessions, selIdx, onSelect]);

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelIdx(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelIdx(prev => sessions.length > 0 ? Math.min(sessions.length - 1, prev + 1) : 0);
      return;
    }
    if (key.return) {
      confirm();
    }
  });

  return (
    // 主容器：纵向排列，圆角边框，padding 1，宽度 100%
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" width="100%">
      <Box marginBottom={1}>
        {/* bold 标题 + dimColor 提示文字，控制视觉层级 */}
        <Text bold>{t().sessions}</Text>
        <Text dimColor>{t().sessionHint}</Text>
      </Box>

      {/* 三种状态的展示：加载中 / 出错 / 列表为空 */}
      {loading && <Text dimColor>{t().loading}</Text>}
      {error && <Text color="error">{t().error}{error}</Text>}

      {!loading && !error && sessions.length === 0 && (
        <Text dimColor>{t().noSessions}</Text>
      )}

      {sessions.map((s, i) => (
        <Box key={s.id}>
          <Text>{i === selIdx ? '❯ ' : '  '}</Text>
          {/* bold 当前选中项，取 sessionId 前 8 位作简短标识 */}
          <Text bold={i === selIdx}>{s.id.slice(0, 8)}</Text>
          <Text> — {fmtTime(s.ts)}</Text>
          {/* dimColor 展示消息数和 Token 使用量，弱化辅助信息 */}
          <Text dimColor>{t().msgs(s.userMessages)}</Text>
          <Text dimColor> in{fmtTokens(s.inputTokens)} out{fmtTokens(s.outputTokens)}</Text>
        </Box>
      ))}
    </Box>
  );
}
