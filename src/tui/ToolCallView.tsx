// src/tui/ToolCallView.tsx - Card-style tool execution display

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
  read_file: '📖',
  write_file: '✏️',
  edit_file: '🔧',
  shell: '💻',
  glob: '🔍',
  grep: '🔎',
  web_fetch: '🌐',
  todo: '📋',
};

function getToolIcon(name: string): string {
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  // MCP tools: mcp_serverName_toolName -> show MCP icon
  if (name.startsWith('mcp_')) return '🔌';
  return '⚡';
}

export const ToolCallView: React.FC<ToolCallViewProps> = ({ name, args, result, error, status, theme }) => {
  const icon = getToolIcon(name);
  const statusColor = status === 'running' ? theme.tone.brand
    : status === 'completed' ? theme.tone.ok
    : status === 'failed' ? theme.tone.err
    : theme.fg.meta;
  const statusGlyph = status === 'running' ? '⟳'
    : status === 'completed' ? theme.card.toolSuccess.glyph
    : status === 'failed' ? theme.card.toolError.glyph
    : '⏸';

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={1}>
      {/* Tool header */}
      <Box>
        <Text color={statusColor}>
          {statusGlyph} {icon}
        </Text>
        <Text color={theme.fg.strong} bold> {name}</Text>
        {status === 'running' && (
          <Text color={theme.tone.brand}> 执行中...</Text>
        )}
      </Box>

      {/* Args preview */}
      <Box paddingLeft={3}>
        <Text dimColor color={theme.fg.meta}>
          {formatArgs(name, args)}
        </Text>
      </Box>

      {/* Error */}
      {error && (
        <Box paddingLeft={3}>
          <Text color={theme.tone.err}>✗ {error}</Text>
        </Box>
      )}

      {/* Result summary */}
      {result && status === 'completed' && (
        <Box paddingLeft={3}>
          <Text dimColor color={theme.fg.sub}>
            {formatResult(name, result)}
          </Text>
        </Box>
      )}

      {/* Diff view for file modifications */}
      {status === 'completed' && name === 'write_file' && typeof args.content === 'string' && (
        <DiffView oldText="" newText={args.content} theme={theme} filePath={String(args.path || '')} />
      )}
      {status === 'completed' && name === 'edit_file' && typeof args.old_string === 'string' && (
        <DiffView oldText={args.old_string} newText={typeof args.new_string === 'string' ? args.new_string : ''} theme={theme} filePath={String(args.path || '')} />
      )}
    </Box>
  );
};

function formatArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
      return String(args.path || '');
    case 'write_file':
      return `${args.path} (${String(args.content || '').split('\n').length} 行)`;
    case 'edit_file':
      return String(args.path || '');
    case 'shell':
      return `$ ${args.command}`;
    case 'glob':
      return String(args.pattern || '');
    case 'grep':
      return `/${args.pattern}/ in ${args.path || '.'}`;
    case 'web_fetch':
      return String(args.url || '');
    default:
      return JSON.stringify(args).slice(0, 100);
  }
}

function formatResult(name: string, result: string): string {
  const lines = result.split('\n');
  if (lines.length > 3) {
    return `${lines.slice(0, 2).join('\n')}  ... (还有 ${lines.length - 2} 行)`;
  }
  return result;
}
