// src/tui/ApprovalDialog.tsx - Approval dialog with risk classification (DeepSeek TUI style)

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

// Risk classification (like CodeWhale)
type RiskLevel = 'safe' | 'destructive';

function classifyRisk(toolName: string): RiskLevel {
  switch (toolName) {
    case 'read_file':
    case 'glob':
    case 'grep':
    case 'todo':
      return 'safe';
    default:
      return 'destructive';
  }
}

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ toolName, args, theme, onApprove, onDeny }) => {
  const risk = classifyRisk(toolName);
  const isDestructive = risk === 'destructive';
  const borderColor = isDestructive ? theme.tone.err : theme.tone.warn;
  const badgeColor = isDestructive ? theme.tone.err : theme.tone.warn;

  useInput((input, key) => {
    if (input === 'y' || input === '1') {
      onApprove(false);
    } else if (input === 'a' || input === '2') {
      onApprove(true);
    } else if (input === 'n' || input === '3' || key.escape) {
      onDeny();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} marginY={1}>
      {/* Header with risk badge */}
      <Box justifyContent="space-between">
        <Text color={theme.tone.warn} bold>⚠️  需要审批</Text>
        {isDestructive && (
          <Text color={badgeColor} bold> [危险操作] </Text>
        )}
      </Box>

      {/* Tool info */}
      <Box marginTop={1}>
        <Text>
          <Text color={theme.tone.brand} bold>{toolName}</Text>
          <Text color={theme.fg.sub}> 请求执行:</Text>
        </Text>
      </Box>

      {/* Args preview */}
      <Box paddingLeft={2} marginTop={1} flexDirection="column">
        <Text color={theme.tone.accent}>{formatApprovalArgs(toolName, args)}</Text>
      </Box>

      {/* Action keys */}
      <Box marginTop={1} gap={2}>
        <Text>
          <Text color={theme.tone.ok} bold>[Y]</Text>
          <Text color={theme.fg.sub}>批准一次  </Text>
          <Text color={theme.tone.accent} bold>[A]</Text>
          <Text color={theme.fg.sub}>始终批准  </Text>
          <Text color={theme.tone.err} bold>[N]</Text>
          <Text color={theme.fg.sub}>拒绝  </Text>
          <Text color={theme.fg.meta}>[Esc]</Text>
        </Text>
      </Box>
    </Box>
  );
};

function formatApprovalArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'write_file':
      return `写入: ${args.path}\n${String(args.content || '').split('\n').length} 行`;
    case 'edit_file':
      return `编辑: ${args.path}`;
    case 'shell':
      return `$ ${args.command}`;
    case 'web_fetch':
      return `获取 ${args.url}`;
    default:
      return JSON.stringify(args, null, 2).slice(0, 200);
  }
}
