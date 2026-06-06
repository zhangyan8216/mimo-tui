// src/tui/CommandPalette.tsx - Ctrl+K command palette (DeepSeek TUI style)

import React, { useState, useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';
import type { AgentMode } from '../api/types.js';

interface Command {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  category: string;
  action: string;
}

interface CommandPaletteProps {
  theme: Theme;
  currentMode: AgentMode;
  onSelect: (action: string) => void;
  onClose: () => void;
}

const COMMANDS: Command[] = [
  { id: 'new', label: '新建会话', description: '开始新的对话', shortcut: 'Ctrl+N', category: '会话', action: 'new' },
  { id: 'save', label: '保存会话', description: '保存当前对话', category: '会话', action: 'save' },
  { id: 'list', label: '会话列表', description: '浏览已保存的会话', shortcut: 'Ctrl+R', category: '会话', action: 'list' },
  { id: 'fork', label: '分支会话', description: '创建当前会话的分支', category: '会话', action: 'fork' },
  { id: 'export', label: '导出对话', description: '导出为 Markdown 文件', category: '会话', action: 'export' },
  { id: 'retry', label: '重试', description: '重新发送上一条消息', category: '会话', action: 'retry' },
  { id: 'undo', label: '撤销', description: '撤销到上一轮对话', category: '会话', action: 'undo' },
  { id: 'plan', label: '切换到计划模式', description: '只读调查模式', category: '模式', action: 'mode:plan' },
  { id: 'agent', label: '切换到智能体模式', description: '交互式审批模式', category: '模式', action: 'mode:agent' },
  { id: 'yolo', label: '切换到自动模式', description: '自动批准所有操作', category: '模式', action: 'mode:yolo' },
  { id: 'clear', label: '清屏', description: '清除聊天记录', shortcut: 'Ctrl+L', category: '工具', action: 'clear' },
  { id: 'compact', label: '压缩上下文', description: '总结较早的消息', category: '工具', action: 'compact' },
  { id: 'git', label: 'Git 状态', description: '查看 Git 仓库状态', category: '工具', action: 'git' },
  { id: 'tree', label: '文件树', description: '显示项目文件结构', category: '工具', action: 'tree' },
  { id: 'project', label: '项目信息', description: '显示项目类型和配置', category: '工具', action: 'project' },
  { id: 'cost', label: '费用统计', description: '查看 token 用量和费用', category: '工具', action: 'cost' },
  { id: 'theme', label: '切换主题', description: '切换界面主题', category: '工具', action: 'theme' },
  { id: 'debug', label: '调试信息', description: '显示系统调试信息', category: '工具', action: 'debug' },
  { id: 'health', label: 'API 健康检查', description: '测试 API 连接和延迟', category: '工具', action: 'health' },
  { id: 'history', label: '命令历史', description: '查看历史命令', category: '工具', action: 'history' },
  { id: 'search', label: '搜索对话', description: '在对话中搜索关键词', category: '工具', action: 'search' },
  { id: 'tokens', label: '上下文用量', description: '查看上下文窗口使用情况', category: '工具', action: 'tokens' },
  { id: 'rename', label: '重命名会话', description: '给当前会话起名', category: '工具', action: 'rename' },
  { id: 'template', label: '对话模板', description: '预设提示词模板', category: '工具', action: 'template' },
  { id: 'snippet', label: '代码片段', description: '管理代码片段库', category: '工具', action: 'snippet' },
  { id: 'config', label: '查看配置', description: '显示当前配置信息', category: '工具', action: 'config' },
  { id: 'stats', label: '会话统计', description: '显示当前会话统计', category: '工具', action: 'stats' },
  { id: 'shortcuts', label: '快捷键速查', description: '显示所有快捷键', category: '工具', action: 'shortcuts' },
  { id: 'help', label: '帮助', description: '键盘快捷键和命令', shortcut: '?', category: '工具', action: 'help' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ theme, currentMode, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return COMMANDS;
    const lower = query.toLowerCase();
    return COMMANDS.filter(cmd =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.description.toLowerCase().includes(lower) ||
      cmd.category.toLowerCase().includes(lower)
    );
  }, [query]);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setSelectedIdx(prev => Math.max(0, prev - 1)); return; }
    if (key.downArrow) { setSelectedIdx(prev => Math.min(filtered.length - 1, prev + 1)); return; }
    if (key.return && filtered.length > 0) { onSelect(filtered[selectedIdx].action); return; }
    if (key.backspace) { setQuery(prev => prev.slice(0, -1)); setSelectedIdx(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery(prev => prev + input); setSelectedIdx(0); }
  });

  // Group by category
  const groups = new Map<string, Command[]>();
  for (const cmd of filtered) {
    const existing = groups.get(cmd.category) || [];
    existing.push(cmd);
    groups.set(cmd.category, existing);
  }

  let globalIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.tone.brand} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={theme.tone.brand} bold>⌘ 命令面板</Text>
        <Text color={theme.fg.meta}>{filtered.length} / {COMMANDS.length}</Text>
      </Box>

      {/* Search input */}
      <Box borderStyle="single" borderColor={theme.fg.faint} marginY={0} paddingX={1}>
        <Text color={theme.tone.accent}>🔍 </Text>
        <Text color={query ? theme.fg.body : theme.fg.meta}>{query || '输入以筛选...'}</Text>
      </Box>

      {/* Command list */}
      <Box flexDirection="column" marginTop={1}>
        {Array.from(groups.entries()).map(([category, cmds]) => (
          <Box key={category} flexDirection="column">
            <Text dimColor color={theme.fg.meta}>{category}</Text>
            {cmds.map(cmd => {
              const idx = globalIdx++;
              const isSelected = idx === selectedIdx;
              return (
                <Box key={cmd.id} paddingLeft={1}>
                  <Text color={isSelected ? theme.tone.brand : theme.fg.body} bold={isSelected}>
                    {isSelected ? '▸ ' : '  '}
                    {cmd.label}
                  </Text>
                  <Text color={theme.fg.sub}> - {cmd.description}</Text>
                  {cmd.shortcut && (
                    <Text color={theme.fg.meta}> [{cmd.shortcut}]</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
        {filtered.length === 0 && (
          <Text dimColor color={theme.fg.meta}>没有匹配的命令</Text>
        )}
      </Box>
    </Box>
  );
};
