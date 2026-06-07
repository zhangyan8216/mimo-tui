// src/agent/modes.ts - Agent mode definitions

import type { AgentMode } from '../api/types.js';

export interface ModeConfig {
  name: AgentMode;
  icon: string;
  label: string;
  description: string;
  autoApproveReads: boolean;
  autoApproveWrites: boolean;
  autoApproveShell: boolean;
  maxIterations: number;
}

export const MODES: Record<AgentMode, ModeConfig> = {
  plan: {
    name: 'plan',
    icon: '🔍',
    label: '计划',
    description: '只读调查模式。先探索和分析，再进行修改。',
    autoApproveReads: true,
    autoApproveWrites: false,
    autoApproveShell: false,
    maxIterations: 32,
  },
  agent: {
    name: 'agent',
    icon: '🤖',
    label: '智能体',
    description: '交互模式，写操作需要审批。',
    autoApproveReads: true,
    autoApproveWrites: false,
    autoApproveShell: false,
    maxIterations: 32,
  },
  yolo: {
    name: 'yolo',
    icon: '⚡',
    label: '自动',
    description: '自动批准所有操作。请谨慎使用。',
    autoApproveReads: true,
    autoApproveWrites: true,
    autoApproveShell: true,
    maxIterations: 32,
  },
};

export function getModeConfig(mode: AgentMode): ModeConfig {
  return MODES[mode];
}

export function isToolAllowedInMode(mode: AgentMode, toolName: string): boolean {
  if (mode === 'plan') {
    // Plan mode: block write tools, allow everything else (including MCP tools)
    const blockedTools = ['write_file', 'edit_file', 'shell', 'web_fetch'];
    return !blockedTools.includes(toolName);
  }
  return true; // agent and yolo allow all tools
}

const READ_ONLY_TOOLS = new Set(['read_file', 'glob', 'grep', 'todo']);

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function needsApproval(mode: AgentMode, toolName: string): boolean {
  const config = MODES[mode];

  // 只读工具永远不需要审批
  if (['read_file', 'glob', 'grep', 'todo', 'codebase'].includes(toolName)) {
    return false;
  }

  // 运维/分析工具不需要审批
  if (['test_runner', 'coverage', 'benchmark', 'code_review', 'database'].includes(toolName)) {
    return false;
  }

  // shell 需要审批（除非 yolo）
  if (toolName === 'shell') {
    return !config.autoApproveShell;
  }

  // 写文件工具
  if (['write_file', 'edit_file', 'multi_edit', 'web_fetch', 'docker'].includes(toolName)) {
    return !config.autoApproveWrites;
  }

  // 默认：agent 模式不审批，plan 模式不允许
  return false;
}
