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
    // Plan mode: only read-only tools
    const readOnlyTools = ['read_file', 'glob', 'grep', 'todo'];
    return readOnlyTools.includes(toolName);
  }
  return true; // agent and yolo allow all tools
}

export function needsApproval(mode: AgentMode, toolName: string): boolean {
  const config = MODES[mode];

  if (toolName === 'read_file' || toolName === 'glob' || toolName === 'grep') {
    return !config.autoApproveReads;
  }
  if (toolName === 'shell') {
    return !config.autoApproveShell;
  }
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'web_fetch') {
    return !config.autoApproveWrites;
  }

  return true;
}
