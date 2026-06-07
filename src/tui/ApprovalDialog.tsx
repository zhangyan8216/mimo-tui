// src/tui/ApprovalDialog.tsx - 审批对话框

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

// 三级风险分类
type RiskLevel = 'read' | 'write' | 'danger';

function classifyRisk(toolName: string, args: Record<string, unknown>): RiskLevel {
  // 只读操作
  if (['read_file', 'glob', 'grep', 'todo', 'codebase', 'benchmark'].includes(toolName)) {
    return 'read';
  }
  // 危险操作
  if (toolName === 'shell') {
    const cmd = String(args.command || '').toLowerCase();
    if (cmd.includes('rm ') || cmd.includes('drop ') || cmd.includes('delete ') ||
        cmd.includes('format ') || cmd.includes('mkfs') || cmd.includes('kill ') ||
        cmd.includes('shutdown') || cmd.includes('reboot')) {
      return 'danger';
    }
  }
  if (toolName === 'write_file') return 'write';
  // 默认写操作
  return 'write';
}

const RISK_CONFIG = {
  read: { icon: '📖', label: '读取', color: 'ok' as const, border: 'faint' as const },
  write: { icon: '✏️', label: '写入', color: 'warn' as const, border: 'warn' as const },
  danger: { icon: '🚨', label: '危险', color: 'err' as const, border: 'err' as const },
};

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ toolName, args, theme, onApprove, onDeny }) => {
  const risk = classifyRisk(toolName, args);
  const config = RISK_CONFIG[risk];
  const riskColor = theme.tone[config.color];

  useInput((input, key) => {
    if (input === 'y' || key.return) {
      onApprove(false);
    } else if (input === 'a') {
      onApprove(true);
    } else if (input === 'n' || key.escape) {
      onDeny();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={riskColor} paddingX={1} marginY={1}>
      {/* 标题行：风险等级 + 工具名 */}
      <Box>
        <Text color={riskColor} bold>{config.icon} [{config.label}] </Text>
        <Text color={theme.tone.brand} bold>{getToolDisplayName(toolName)}</Text>
      </Box>

      {/* 操作详情 */}
      <Box flexDirection="column" marginTop={1} paddingLeft={1}>
        {renderDetail(toolName, args, theme)}
      </Box>

      {/* 分隔线 */}
      <Box marginTop={1}>
        <Text color={theme.fg.faint}>{'─'.repeat(50)}</Text>
      </Box>

      {/* 操作按钮 */}
      <Box marginTop={1}>
        <Text>
          <Text color={theme.tone.ok} bold> [Y] </Text>
          <Text color={theme.fg.body}>批准</Text>
          <Text color={theme.fg.faint}>  │  </Text>
          <Text color={theme.tone.accent} bold> [A] </Text>
          <Text color={theme.fg.body}>始终批准</Text>
          <Text color={theme.fg.faint}>  │  </Text>
          <Text color={theme.tone.err} bold> [N] </Text>
          <Text color={theme.fg.body}>拒绝</Text>
          <Text color={theme.fg.faint}>  │  </Text>
          <Text color={theme.fg.meta}>Enter 确认</Text>
        </Text>
      </Box>
    </Box>
  );
};

/** 工具显示名 */
function getToolDisplayName(name: string): string {
  const names: Record<string, string> = {
    read_file: '读取文件',
    write_file: '写入文件',
    edit_file: '编辑文件',
    shell: '执行命令',
    glob: '搜索文件',
    grep: '搜索内容',
    web_fetch: '获取网页',
    todo: '任务管理',
    codebase: '代码分析',
    test_runner: '运行测试',
    multi_edit: '批量编辑',
    docker: 'Docker',
    coverage: '覆盖率',
    database: '数据库',
    code_review: '代码审查',
    benchmark: '基准测试',
  };
  return names[name] || name;
}

/** 渲染操作详情 */
function renderDetail(toolName: string, args: Record<string, unknown>, theme: Theme): React.ReactNode {
  switch (toolName) {
    case 'write_file': {
      const content = String(args.content || '');
      const lines = content.split('\n');
      const preview = lines.slice(0, 8);
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>📄 {String(args.path || '')}</Text>
          <Text color={theme.fg.meta}>  {lines.length} 行 · {(content.length / 1024).toFixed(1)}KB</Text>
          <Box marginTop={1} flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={theme.fg.faint}>
            {preview.map((line, i) => (
              <Text key={i} color={theme.diff?.added || theme.tone.ok}>+ {line}</Text>
            ))}
            {lines.length > 8 && <Text color={theme.fg.meta}>  ...还有 {lines.length - 8} 行</Text>}
          </Box>
        </Box>
      );
    }

    case 'edit_file': {
      const oldStr = String(args.old_string || '');
      const newStr = String(args.new_string || '');
      const oldLines = oldStr.split('\n');
      const newLines = newStr.split('\n');
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>📝 {String(args.path || '')}</Text>
          <Box marginTop={1} flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={theme.fg.faint}>
            {oldLines.slice(0, 4).map((line, i) => (
              <Text key={`old-${i}`} color={theme.diff?.removed || theme.tone.err}>- {line}</Text>
            ))}
            {oldLines.length > 4 && <Text color={theme.fg.meta}>  ...还有 {oldLines.length - 4} 行</Text>}
            {newLines.slice(0, 4).map((line, i) => (
              <Text key={`new-${i}`} color={theme.diff?.added || theme.tone.ok}>+ {line}</Text>
            ))}
            {newLines.length > 4 && <Text color={theme.fg.meta}>  ...还有 {newLines.length - 4} 行</Text>}
          </Box>
          <Text color={theme.fg.meta}>  替换 {oldLines.length} 行 → {newLines.length} 行</Text>
        </Box>
      );
    }

    case 'shell': {
      const cmd = String(args.command || '');
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>💻</Text>
          <Box paddingLeft={1} borderStyle="single" borderColor={theme.fg.faint}>
            <Text color={theme.tone.accent}>$ {cmd}</Text>
          </Box>
        </Box>
      );
    }

    case 'multi_edit': {
      const edits = args.edits as Array<{ file: string }> || [];
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>📝 批量编辑 {edits.length} 个文件:</Text>
          {edits.slice(0, 5).map((e, i) => (
            <Text key={i} color={theme.fg.sub}>  • {e.file}</Text>
          ))}
          {edits.length > 5 && <Text color={theme.fg.meta}>  ...还有 {edits.length - 5} 个</Text>}
        </Box>
      );
    }

    case 'web_fetch':
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>🌐 {String(args.url || '')}</Text>
        </Box>
      );

    case 'database':
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>🗄️ {String(args.action || '')} → {String(args.db_path || '')}</Text>
          {args.sql ? <Text color={theme.tone.accent}>  SQL: {String(args.sql).slice(0, 80)}</Text> : null}
        </Box>
      );

    case 'docker':
      return (
        <Box flexDirection="column">
          <Text color={theme.fg.body}>🐳 docker {String(args.action || '')} {String(args.target || '')}</Text>
          {args.args ? <Text color={theme.fg.meta}>  参数: {String(args.args)}</Text> : null}
        </Box>
      );

    default:
      return (
        <Text color={theme.fg.sub}>
          {JSON.stringify(args, null, 2).slice(0, 200)}
        </Text>
      );
  }
}
