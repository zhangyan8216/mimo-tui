// src/tui/StatusBar.tsx - Rich status bar with chip/pill rendering (DeepSeek TUI style)

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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const StatusBar: React.FC<StatusBarProps> = ({
  mode, model, usage, theme, streaming, branch, gitDirty, iteration, maxIterations,
}) => {
  const [spinnerIdx, setSpinnerIdx] = useState(0);

  // Spinner animation when streaming
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setSpinnerIdx(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [streaming]);

  const modeConfig = getModeConfig(mode);
  const modeColor = theme.pill.mode[mode] || theme.tone.brand;

  // Context usage bar
  const contextPct = usage.totalTokens > 0 ? Math.min(usage.totalTokens / 128000, 1) : 0;
  const barWidth = 10;
  const filled = Math.round(contextPct * barWidth);
  const contextBar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  const contextColor = contextPct > 0.8 ? theme.tone.err : contextPct > 0.5 ? theme.tone.warn : theme.tone.ok;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderColor={theme.fg.faint}
      paddingX={1}
    >
      {/* Left: Mode + Model + Branch */}
      <Box flexDirection="row" gap={1}>
        {/* Streaming spinner */}
        {streaming && (
          <Text color={theme.tone.brand}>{SPINNER_FRAMES[spinnerIdx]}</Text>
        )}

        {/* Mode chip */}
        <Text>
          <Text color={modeColor} bold>{modeConfig.icon} {modeConfig.label}</Text>
        </Text>

        {/* Separator */}
        <Text color={theme.fg.faint}>│</Text>

        {/* Model pill */}
        <Text color={theme.pill.model}>{model}</Text>

        {/* Git branch */}
        {branch && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={gitDirty ? theme.tone.warn : theme.pill.branch}>
              ⎇ {branch}{gitDirty ? ' ✱' : ''}
            </Text>
          </>
        )}
      </Box>

      {/* Right: Tokens + Cache + Cost + Context bar */}
      <Box flexDirection="row" gap={1}>
        {/* Iteration counter */}
        {iteration !== undefined && iteration > 0 && maxIterations !== undefined && (
          <>
            <Text color={theme.fg.meta}>迭代 {iteration}/{maxIterations}</Text>
            <Text color={theme.fg.faint}>│</Text>
          </>
        )}

        {/* Token count */}
        <Text color={theme.fg.sub}>
          {formatTokenCount(usage.totalTokens)} 令牌
        </Text>

        {/* Cache rate pill */}
        {usage.cacheHitTokens > 0 && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={theme.pill.cache}>缓存 {formatCacheRate(usage)}</Text>
          </>
        )}

        {/* Cost pill */}
        {usage.totalTokens > 0 && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={theme.pill.cost}>{formatCost(usage)}</Text>
          </>
        )}

        {/* Context usage bar */}
        {usage.totalTokens > 0 && (
          <>
            <Text color={theme.fg.faint}>│</Text>
            <Text color={contextColor}>{contextBar}</Text>
          </>
        )}
      </Box>
    </Box>
  );
};
