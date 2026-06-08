// src/tui/SessionPicker.tsx - Ctrl+R session picker (with delete confirmation & scroll)

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
  const [scroll, setScroll] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const viewHeight = 15;

  const filtered = useMemo(() => {
    if (!query) return sessions;
    const lower = query.toLowerCase();
    return sessions.filter(s =>
      s.name.toLowerCase().includes(lower) ||
      s.model.toLowerCase().includes(lower)
    );
  }, [sessions, query]);

  // Clamp scroll when filtered changes
  const maxScroll = Math.max(0, filtered.length - viewHeight);
  const clampedScroll = Math.min(scroll, maxScroll);

  useInput((input, key) => {
    if (key.escape) {
      if (confirmDelete) { setConfirmDelete(null); return; }
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx(prev => {
        const next = Math.max(0, prev - 1);
        if (next < clampedScroll) setScroll(next);
        return next;
      });
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(prev => {
        const next = Math.min(filtered.length - 1, prev + 1);
        if (next >= clampedScroll + viewHeight) setScroll(next - viewHeight + 1);
        return next;
      });
      return;
    }
    if (key.return) {
      if (confirmDelete && onDelete) {
        onDelete(confirmDelete);
        setConfirmDelete(null);
        return;
      }
      if (filtered.length > 0) {
        const idx = Math.min(selectedIdx, filtered.length - 1);
        onSelect(filtered[idx].id);
      }
      return;
    }
    if (key.ctrl && input === 'd' && filtered.length > 0 && onDelete) {
      const idx = Math.min(selectedIdx, filtered.length - 1);
      setConfirmDelete(filtered[idx].id);
      return;
    }
    if (key.backspace) { setQuery(prev => prev.slice(0, -1)); setSelectedIdx(0); setScroll(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery(prev => prev + input); setSelectedIdx(0); setScroll(0); }
  });

  const visible = filtered.slice(clampedScroll, clampedScroll + viewHeight);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.tone.brand} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={theme.tone.brand} bold>📂 会话列表</Text>
        <Text color={theme.fg.meta}>{filtered.length} 个 · ↑↓滚动</Text>
      </Box>

      {/* Search */}
      <Box borderStyle="single" borderColor={theme.fg.faint} paddingX={1}>
        <Text color={theme.tone.accent}>🔍 </Text>
        <Text color={query ? theme.fg.body : theme.fg.meta}>{query || '搜索会话...'}</Text>
      </Box>

      {/* Delete confirmation */}
      {confirmDelete && (
        <Box marginTop={0}>
          <Text color={theme.tone.err} bold>⚠️ 确认删除？Enter 确认 · Esc 取消</Text>
        </Box>
      )}

      {/* Session list */}
      <Box flexDirection="column" marginTop={0}>
        {filtered.length === 0 ? (
          <Text dimColor color={theme.fg.meta}>未找到会话</Text>
        ) : (
          visible.map((session) => {
            const realIdx = filtered.indexOf(session);
            const isSelected = realIdx === selectedIdx;
            const isDeleting = confirmDelete === session.id;
            const date = new Date(session.updated_at);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const timeStr = `${year}/${month}/${day} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            const msgCount = session.messages.length;

            return (
              <Box key={session.id} paddingLeft={1}>
                <Text color={isDeleting ? theme.tone.err : isSelected ? theme.tone.brand : theme.fg.body} bold={isSelected}>
                  {isDeleting ? '🗑️' : isSelected ? '▸ ' : '  '}
                  {session.name}
                </Text>
                <Text color={theme.fg.meta}>
                  {' '}{session.model} · {msgCount} 条 · {timeStr}
                </Text>
                {session.branch !== 'main' && (
                  <Text color={theme.tone.accent}> ⎇ {session.branch}</Text>
                )}
              </Box>
            );
          })
        )}
        {clampedScroll > 0 && <Text color={theme.fg.faint}>  ↑ 更多...</Text>}
        {clampedScroll + viewHeight < filtered.length && <Text color={theme.fg.faint}>  ↓ 更多...</Text>}
      </Box>

      <Box marginTop={0}>
        <Text dimColor color={theme.fg.meta}>
          ↑↓ 导航 · Enter 选择 · Ctrl+D 删除 · Esc 关闭
        </Text>
      </Box>
    </Box>
  );
};
