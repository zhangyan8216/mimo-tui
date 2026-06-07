// src/tui/ApprovalDialog.tsx - 紧凑型审批条

import React from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';

interface ApprovalDialogProps {
  toolName: string;
  args: Record<string, unknown>;
  theme: Theme;
  onApprove: (always: boolean) => void;
  onDeny: () => void;
}

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ toolName, args, theme, onApprove, onDeny }) => {
  const isDanger = isDangerous(toolName, args);

  useInput((input, key) => {
    if (input === 'y' || key.return) onApprove(false);
    else if (input === 'a') onApprove(true);
    else if (input === 'n' || key.escape) onDeny();
  });

  return (
    <Box borderStyle="single" borderColor={isDanger ? theme.tone.err : theme.tone.warn} paddingX={1} marginY={0} gap={1}>
      {/* 左侧：图标 + 工具 + 参数摘要 */}
      <Text>
        <Text color={isDanger ? theme.tone.err : theme.tone.warn} bold>
          {isDanger ? '🚨' : '⚡'} {getToolLabel(toolName)}
        </Text>
        <Text color={theme.fg.faint}> │ </Text>
        <Text color={theme.fg.sub}>{getArgSummary(toolName, args)}</Text>
      </Text>

      {/* 右侧：操作提示 */}
      <Text>
        <Text color={theme.tone.ok} bold>y</Text>
        <Text color={theme.fg.meta}>/</Text>
        <Text color={theme.tone.accent} bold>a</Text>
        <Text color={theme.fg.meta}>/</Text>
        <Text color={theme.tone.err} bold>n</Text>
      </Text>
    </Box>
  );
};

function isDangerous(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === 'shell') {
    const cmd = String(args.command || '').toLowerCase();
    return cmd.includes('rm ') || cmd.includes('drop ') || cmd.includes('delete ') ||
           cmd.includes('format ') || cmd.includes('mkfs') || cmd.includes('kill ') ||
           cmd.includes('shutdown') || cmd.includes('reboot');
  }
  return false;
}

function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    write_file: '写入', edit_file: '编辑', multi_edit: '批量编辑',
    shell: '命令', web_fetch: '获取', docker: 'Docker',
  };
  return labels[name] || name;
}

function getArgSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'write_file':
      return `${args.path} (${String(args.content || '').split('\n').length}行)`;
    case 'edit_file':
      return `${args.path}`;
    case 'multi_edit': {
      const edits = args.edits as Array<{ file: string }> || [];
      return `${edits.length}个文件`;
    }
    case 'shell':
      return String(args.command || '').slice(0, 60);
    case 'web_fetch':
      return String(args.url || '').slice(0, 60);
    case 'docker':
      return `docker ${args.action} ${args.target || ''}`;
    default:
      return JSON.stringify(args).slice(0, 60);
  }
}
