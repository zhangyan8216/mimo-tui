// src/tui/StatusBar.tsx - 状态栏

import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';
import type { AgentMode, TokenUsage } from '../api/types.js';
import { getModeConfig } from '../agent/modes.js';
import { formatTokenCount, formatCost, formatCacheRate } from '../utils/tokens.js';

interface StatusBarProps {
  mode: AgentMode;
  model: string;
  usage: TokenUsage;
  theme: Theme;
  streaming?: boolean;
  branch?: string;
  gitDirty?: boolean;
  iteration?: number;
  maxIterations?: number;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const StatusBar: React.FC<StatusBarProps> = ({
  mode, model, usage, theme, streaming, branch, gitDirty, iteration, maxIterations,
}) => {
  const [spinnerIdx, setSpinnerIdx] = useState(0);

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setSpinnerIdx(prev => (prev + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [streaming]);

  const modeConfig = getModeConfig(mode);
  const modeColor = theme.pill.mode[mode] || theme.tone.brand;

  // 上下文进度条
  const contextPct = usage.totalTokens > 0 ? Math.min(usage.totalTokens / 128000, 1) : 0;
  const barWidth = 8;
  const filled = Math.round(contextPct * barWidth);
  const contextBar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  const contextColor = contextPct > 0.8 ? theme.tone.err : contextPct > 0.5 ? theme.tone.warn : theme.tone.ok;

  return (
    <Box flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor={theme.fg.faint} paddingX={1}>
      {/* 左侧 */}
      <Box flexDirection="row" gap={1}>
        {streaming && <Text color={theme.tone.brand}>{SPINNER[spinnerIdx]}</Text>}
        <Text color={modeColor} bold>{modeConfig.icon} {modeConfig.label}</Text>
        <Text color={theme.fg.faint}>│</Text>
        <Text color={theme.fg.sub}>{model}</Text>
        {branch && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={gitDirty ? theme.tone.warn : theme.fg.sub}>⎇ {branch}{gitDirty ? ' ✱' : ''}</Text>
          </>
        )}
      </Box>

      {/* 右侧 */}
      <Box flexDirection="row" gap={1}>
        {iteration !== undefined && iteration > 0 && (
          <>
            <Text color={theme.fg.faint}>{iteration}/{maxIterations}</Text>
            <Text color={theme.fg.faint}>│</Text>
          </>
        )}
        <Text color={theme.fg.faint}>{formatTokenCount(usage.totalTokens)}</Text>
        {usage.cacheHitTokens > 0 && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={theme.fg.sub}>缓存 {formatCacheRate(usage)}</Text>
          </>
        )}
        {usage.totalTokens > 0 && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={theme.fg.sub}>{formatCost(usage)}</Text>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={contextColor}>{contextBar}</Text>
          </>
        )}
      </Box>
    </Box>
  );
};
