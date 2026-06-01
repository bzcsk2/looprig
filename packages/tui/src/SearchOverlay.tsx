/** SearchOverlay — Ctrl+F message search with Ink screen-space highlighting. */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from '@deepicode/ink';
import { useSearchHighlight } from '@deepicode/ink';
import { FG, TONE } from './reasonix/tokens.js';
import { t } from './i18n/index.js';
import type { TimelineItem } from './bridge.js';

interface SearchOverlayProps {
  timeline: TimelineItem[];
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResult {
  itemId: string;
  source: 'user' | 'assistant' | 'reasoning' | 'tool';
  text: string;
}

function collectSearchableText(timeline: TimelineItem[]): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of timeline) {
    if (item.kind === 'message') {
      const text = item.message.content ?? '';
      if (text) results.push({ itemId: item.id, source: item.message.role as 'user' | 'assistant', text });
    } else {
      const turn = item.turn;
      if (turn.userText) results.push({ itemId: item.id, source: 'user', text: turn.userText });
      if (turn.assistantText) results.push({ itemId: item.id, source: 'assistant', text: turn.assistantText });
      if (turn.reasoningText) results.push({ itemId: item.id, source: 'reasoning', text: turn.reasoningText });
      for (const tool of turn.tools) {
        if (tool.output) results.push({ itemId: item.id, source: 'tool', text: tool.output });
      }
    }
  }
  return results;
}

const SOURCE_LABELS: Record<string, string> = {
  user: 'U',
  assistant: 'A',
  reasoning: 'R',
  tool: 'T',
};

export function SearchOverlay({ timeline, isOpen, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const { setQuery: setHighlight } = useSearchHighlight();

  const searchResults = useMemo(() => collectSearchableText(timeline), [timeline]);

  const matchCount = useMemo(() => {
    if (!query) return 0;
    const lower = query.toLowerCase();
    return searchResults.filter(r => r.text.toLowerCase().includes(lower)).length;
  }, [query, searchResults]);

  useEffect(() => {
    setHighlight(query);
    setMatchIdx(0);
  }, [query, setHighlight]);

  const handleKeyDown = useCallback((input: string, key: { escape?: boolean; return?: boolean; upArrow?: boolean; downArrow?: boolean; ctrl?: boolean }) => {
    if (!isOpen) return;

    if (key.escape) {
      if (query.length > 0) {
        setQuery('');
        setHighlight('');
      } else {
        onClose();
      }
      return;
    }

    if (key.return || key.downArrow) {
      if (matchCount > 0) {
        setMatchIdx(prev => (prev + 1) % matchCount);
      }
      return;
    }

    if (key.upArrow) {
      if (matchCount > 0) {
        setMatchIdx(prev => (prev - 1 + matchCount) % matchCount);
      }
      return;
    }

    if (key.ctrl && input === 'f') {
      onClose();
      return;
    }
  }, [isOpen, query, matchCount, onClose, setHighlight]);

  useInput(handleKeyDown, { isActive: isOpen });

  if (!isOpen) return null;

  return (
    <Box
      flexDirection="column"
      width="100%"
      borderStyle="round"
      borderColor={TONE.brand}
      paddingX={1}
      marginBottom={1}
    >
      <Box>
        <Text color={TONE.brand}>🔍 </Text>
        <Text>{query}</Text>
        <Text color={FG.faint}>{'▊'}</Text>
        {query && (
          <Text dimColor>  {matchCount > 0 ? `${matchIdx + 1}/${matchCount}` : 'no match'}</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>{t().searchHint}</Text>
      </Box>
    </Box>
  );
}
