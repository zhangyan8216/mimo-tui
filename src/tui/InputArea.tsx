// src/tui/InputArea.tsx - Input area with @-mentions & history

import React, { useState } from 'react';
import { Text, Box, useInput, useFocus } from 'ink';
import type { Theme } from './theme.js';

interface InputAreaProps {
  theme: Theme;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export const InputArea: React.FC<InputAreaProps> = ({
  theme, onSubmit, onCancel, disabled, placeholder = '输入消息...',
}) => {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const { isFocused } = useFocus({ autoFocus: true });

  useInput((input, key) => {
    if (disabled) return;

    // Cancel
    if (key.escape) {
      onCancel?.();
      return;
    }

    // Submit
    if (key.return && !key.shift) {
      const trimmed = text.trim();
      if (trimmed) {
        setHistory(prev => [...prev, trimmed]);
        setHistoryIdx(-1);
        onSubmit(trimmed);
        setText('');
        setCursorPos(0);
      }
      return;
    }

    // History navigation
    if (key.upArrow && history.length > 0) {
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setText(history[newIdx]);
      setCursorPos(history[newIdx].length);
      return;
    }

    if (key.downArrow) {
      if (historyIdx === -1) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setText('');
        setCursorPos(0);
      } else {
        setHistoryIdx(newIdx);
        setText(history[newIdx]);
        setCursorPos(history[newIdx].length);
      }
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setText(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(prev => prev - 1);
      }
      return;
    }

    // Home (Ctrl+A)
    if (key.ctrl && input === 'a') {
      setCursorPos(0);
      return;
    }

    // End (Ctrl+E)
    if (key.ctrl && input === 'e') {
      setCursorPos(text.length);
      return;
    }

    // Ctrl+U - clear line
    if (key.ctrl && input === 'u') {
      setText('');
      setCursorPos(0);
      return;
    }

    // Ctrl+K - clear to end
    if (key.ctrl && input === 'k') {
      setText(prev => prev.slice(0, cursorPos));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setText(prev => prev.slice(0, cursorPos) + input + prev.slice(cursorPos));
      setCursorPos(prev => prev + input.length);
    }
  });

  const hasAtMention = text.includes('@');
  const hasSlash = text.startsWith('/');

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? theme.tone.brand : theme.fg.faint}
      paddingX={1}
    >
      <Box>
        <Text color={theme.tone.accent} bold>{'>'} </Text>
        <Text color={text ? theme.fg.body : theme.fg.meta}>
          {text || (isFocused ? '' : placeholder)}
        </Text>
        {isFocused && <Text color={theme.tone.brand} bold>▊</Text>}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor color={theme.fg.meta}>
          {hasAtMention ? '📎 @文件引用' : hasSlash ? '⌨️  斜杠命令' : ''}
        </Text>
        <Text dimColor color={theme.fg.meta}>
          Enter 发送 · Esc 取消
        </Text>
      </Box>
    </Box>
  );
};
