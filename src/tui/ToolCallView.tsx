// src/tui/ToolCallView.tsx - 工具调用显示

import React from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';
import { DiffView } from './DiffView.js';

interface ToolCallViewProps {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  theme: Theme;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖', write_file: '✏️', edit_file: '🔧', shell: '💻',
  glob: '🔍', grep: '🔎', web_fetch: '🌐', todo: '📋',
};

function getToolIcon(name: string): string {
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  if (name.startsWith('mcp_')) return '🔌';
  return '⚡';
}

export const ToolCallView: React.FC<ToolCallViewProps> = ({ name, args, result, error, status, theme }) => {
  const icon = getToolIcon(name);
  const statusColor = status === 'running' ? theme.tone.brand
    : status === 'completed' ? theme.tone.ok
    : status === 'failed' ? theme.tone.err
    : theme.fg.meta;

  return (
    <Box flexDirection="column" marginY={0}>
      {/* 工具名 + 状态 */}
      <Box>
        <Text color={statusColor}>{status === 'running' ? '⟳' : status === 'completed' ? '✓' : status === 'failed' ? '✗' : '⏸'} </Text>
        <Text color={theme.fg.body}>{icon} {formatToolName(name)}</Text>
        <Text color={theme.fg.faint}> {formatArgs(name, args)}</Text>
      </Box>

      {/* 错误 */}
      {error && (
        <Box paddingLeft={3}>
          <Text color={theme.tone.err}>✗ {error}</Text>
        </Box>
      )}

      {/* 结果摘要 */}
      {result && status === 'completed' && (
        <Box paddingLeft={3}>
          <Text color={theme.fg.faint}>{formatResult(result)}</Text>
        </Box>
      )}

      {/* Diff 预览 */}
      {status === 'completed' && name === 'write_file' && typeof args.content === 'string' && (
        <DiffView oldText="" newText={args.content} theme={theme} filePath={String(args.path || '')} />
      )}
      {status === 'completed' && name === 'edit_file' && typeof args.old_string === 'string' && (
        <DiffView oldText={args.old_string} newText={typeof args.new_string === 'string' ? args.new_string : ''} theme={theme} filePath={String(args.path || '')} />
      )}
    </Box>
  );
};

function formatToolName(name: string): string {
  const names: Record<string, string> = {
    read_file: '读取', write_file: '写入', edit_file: '编辑', shell: '命令',
    glob: '搜索', grep: '搜索', web_fetch: '获取', todo: '任务',
    codebase: '分析', test_runner: '测试', multi_edit: '批量编辑',
    docker: 'Docker', coverage: '覆盖率', database: '数据库',
    code_review: '审查', benchmark: '基准',
  };
  return names[name] || name;
}

function formatArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return String(args.path || '');
    case 'write_file': return `${args.path} (${String(args.content || '').split('\n').length}行)`;
    case 'edit_file': return String(args.path || '');
    case 'shell': return `$ ${String(args.command || '').slice(0, 50)}`;
    case 'glob': return String(args.pattern || '');
    case 'grep': return `${args.pattern} in ${args.path || '.'}`;
    case 'web_fetch': return String(args.url || '').slice(0, 50);
    case 'codebase': return String(args.action || '');
    case 'test_runner': return String(args.action || 'run');
    default: return JSON.stringify(args).slice(0, 50);
  }
}

function formatResult(result: string): string {
  const lines = result.split('\n');
  if (lines.length > 2) return `${lines[0].slice(0, 60)}… (${lines.length}行)`;
  return result.slice(0, 80);
}
