// src/tui/InputArea.tsx - 输入区域

import React, { useState, useCallback } from 'react';
import { Text, Box, useInput, useFocus } from 'ink';
import fs from 'fs';
import path from 'path';
import type { Theme } from './theme.js';

interface InputAreaProps {
  theme: Theme;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  placeholder?: string;
  slashCommands?: string[];
  initialHistory?: string[];
}

export const InputArea: React.FC<InputAreaProps> = ({
  theme, onSubmit, onCancel, disabled, placeholder = '输入消息…', slashCommands = [], initialHistory = [],
}) => {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [history, setHistory] = useState<string[]>(initialHistory);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [tabIdx, setTabIdx] = useState(-1);
  const [atMatches, setAtMatches] = useState<string[]>([]);
  const [atIdx, setAtIdx] = useState(-1);
  const { isFocused } = useFocus({ autoFocus: true });

  const searchFiles = useCallback((prefix: string): string[] => {
    const cwd = process.cwd();
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
    const results: string[] = [];
    const maxResults = 10;
    function walk(dir: string, rel: string) {
      if (results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath);
        else if (entry.isFile() && relPath.toLowerCase().startsWith(prefix.toLowerCase())) results.push(relPath);
      }
    }
    walk(cwd, '');
    return results;
  }, []);

  useInput((input, key) => {
    if (disabled) return;
    if (key.escape) { onCancel?.(); return; }

    // 发送
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

    // 换行
    if (key.return && key.shift) {
      setText(prev => prev.slice(0, cursorPos) + '\n' + prev.slice(cursorPos));
      setCursorPos(prev => prev + 1);
      return;
    }

    // Tab 补全：斜杠命令
    if (key.tab && text.startsWith('/') && slashCommands.length > 0) {
      const prefix = text.slice(1).toLowerCase();
      const matches = slashCommands.filter(c => c.startsWith(prefix));
      if (matches.length > 0) {
        const nextIdx = (tabIdx + 1) % matches.length;
        const completion = '/' + matches[nextIdx] + ' ';
        setText(completion);
        setCursorPos(completion.length);
        setTabIdx(nextIdx);
      }
      return;
    }

    // Tab 补全：@文件路径
    if (key.tab) {
      const beforeCursor = text.slice(0, cursorPos);
      const atMatch = beforeCursor.match(/@(\S*)$/);
      if (atMatch) {
        const prefix = atMatch[1];
        let matches = atMatches;
        if (atIdx === -1 || prefix !== (atMatches[0] || '').slice(0, prefix.length)) {
          matches = searchFiles(prefix);
          setAtMatches(matches);
        }
        if (matches.length > 0) {
          const nextIdx = (atIdx + 1) % matches.length;
          setAtIdx(nextIdx);
          const atStart = cursorPos - prefix.length;
          const completed = text.slice(0, atStart) + matches[nextIdx] + text.slice(cursorPos);
          setText(completed);
          setCursorPos(atStart + matches[nextIdx].length);
          // After full completion, reset so next Tab re-searches with new prefix
          if (nextIdx === matches.length - 1) {
            setAtIdx(-1);
            setAtMatches([]);
          }
        }
        return;
      }
    }

    if (!key.tab && tabIdx !== -1) setTabIdx(-1);
    if (!key.tab && atIdx !== -1) setAtIdx(-1);

    // 历史导航
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
        setHistoryIdx(-1); setText(''); setCursorPos(0);
      } else {
        setHistoryIdx(newIdx); setText(history[newIdx]); setCursorPos(history[newIdx].length);
      }
      return;
    }

    // 删除
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setText(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(prev => prev - 1);
      }
      return;
    }

    // Home/End
    if (key.ctrl && input === 'a') { setCursorPos(0); return; }
    if (key.ctrl && input === 'e') { setCursorPos(text.length); return; }
    if (key.ctrl && input === 'u') { setText(''); setCursorPos(0); return; }

    // 普通输入
    if (input && !key.ctrl && !key.meta) {
      setText(prev => prev.slice(0, cursorPos) + input + prev.slice(cursorPos));
      setCursorPos(prev => prev + input.length);
    }
  });

  const hasSlash = text.startsWith('/');
  const hasAt = text.includes('@');
  const lineCount = (text.match(/\n/g) || []).length + 1;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? theme.tone.brand : theme.fg.faint} paddingX={1}>
      {/* 输入内容 */}
      {text.includes('\n') ? (
        text.split('\n').map((line, i) => (
          <Box key={i}>
            {i === 0 ? <Text color={theme.tone.accent} bold>{'>'} </Text> : <Text color={theme.fg.faint}>  </Text>}
            <Text color={theme.fg.body}>{line}</Text>
            {i === lineCount - 1 && isFocused && <Text color={theme.tone.brand} bold>▊</Text>}
          </Box>
        ))
      ) : (
        <Box>
          <Text color={theme.tone.accent} bold>{'>'} </Text>
          <Text color={text ? theme.fg.body : theme.fg.meta}>{text || (isFocused ? '' : placeholder)}</Text>
          {isFocused && <Text color={theme.tone.brand} bold>▊</Text>}
        </Box>
      )}

      {/* 底部提示 */}
      <Box justifyContent="space-between">
        <Text color={theme.fg.faint}>
          {lineCount > 1 ? `${lineCount} 行` : hasSlash ? 'Tab 补全' : hasAt ? 'Tab 补全' : ''}
        </Text>
        <Text color={theme.fg.faint}>
          Enter 发送 · Shift+Enter 换行 · ↑↓ 历史
        </Text>
      </Box>
    </Box>
  );
};
