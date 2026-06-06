// src/tui/SessionPicker.tsx - Ctrl+R session picker

import React, { useState, useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';
import type { Session } from '../api/types.js';

interface SessionPickerProps {
  sessions: Session[];
  theme: Theme;
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onClose: () => void;
}

export const SessionPicker: React.FC<SessionPickerProps> = ({
  sessions, theme, onSelect, onDelete, onClose,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return sessions;
    const lower = query.toLowerCase();
    return sessions.filter(s =>
      s.name.toLowerCase().includes(lower) ||
      s.model.toLowerCase().includes(lower)
    );
  }, [sessions, query]);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setSelectedIdx(prev => Math.max(0, prev - 1)); return; }
    if (key.downArrow) { setSelectedIdx(prev => Math.min(filtered.length - 1, prev + 1)); return; }
    if (key.return && filtered.length > 0) { onSelect(filtered[selectedIdx].id); return; }
    if (key.ctrl && input === 'd' && filtered.length > 0 && onDelete) { onDelete(filtered[selectedIdx].id); return; }
    if (key.backspace) { setQuery(prev => prev.slice(0, -1)); setSelectedIdx(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery(prev => prev + input); setSelectedIdx(0); }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.tone.brand} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={theme.tone.brand} bold>📂 会话列表</Text>
        <Text color={theme.fg.meta}>{filtered.length} 个会话</Text>
      </Box>

      {/* Search */}
      <Box borderStyle="single" borderColor={theme.fg.faint} paddingX={1}>
        <Text color={theme.tone.accent}>🔍 </Text>
        <Text color={query ? theme.fg.body : theme.fg.meta}>{query || '搜索会话...'}</Text>
      </Box>

      {/* Session list */}
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 ? (
          <Text dimColor color={theme.fg.meta}>未找到会话</Text>
        ) : (
          filtered.map((session, i) => {
            const isSelected = i === selectedIdx;
            const date = new Date(session.updated_at);
            const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            const msgCount = session.messages.length;

            return (
              <Box key={session.id} paddingLeft={1}>
                <Text color={isSelected ? theme.tone.brand : theme.fg.body} bold={isSelected}>
                  {isSelected ? '▸ ' : '  '}
                  {session.name}
                </Text>
                <Text color={theme.fg.meta}>
                  {' '}{session.model} · {msgCount} 条消息 · {timeStr}
                </Text>
                {session.branch !== 'main' && (
                  <Text color={theme.tone.accent}> ⎇ {session.branch}</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor color={theme.fg.meta}>
          ↑↓ 导航 · Enter 选择 · Esc 关闭
        </Text>
      </Box>
    </Box>
  );
};
