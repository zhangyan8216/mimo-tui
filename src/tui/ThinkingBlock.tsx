// src/tui/ThinkingBlock.tsx - Thinking/reasoning display with spinner animation

import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';

interface ThinkingBlockProps {
  content: string;
  theme: Theme;
  streaming?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content, theme, streaming, collapsed: externalCollapsed, onToggle,
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(true);
  const [spinnerIdx, setSpinnerIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const collapsed = externalCollapsed ?? internalCollapsed;

  // Spinner animation
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setSpinnerIdx(prev => (prev + 1) % SPINNER.length);
      setElapsed(prev => prev + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [streaming]);

  if (!content) return null;

  const lines = content.split('\n');
  const preview = lines[0]?.slice(0, 80) + (lines[0] && lines[0].length > 80 ? '...' : '');
  const duration = streaming ? `${(elapsed / 10).toFixed(1)}s` : `${lines.length} 行`;
  const card = theme.card.thinking;

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Header */}
      <Box paddingLeft={1}>
        <Text color={card.color}>
          {streaming ? (
            <>
              <Text bold>{SPINNER[spinnerIdx]}</Text>
              {' Thinking '}
              <Text dimColor>({duration})</Text>
            </>
          ) : collapsed ? (
            <>
              <Text>{card.glyph}</Text>
              {' 推理 '}
              <Text dimColor>({duration})</Text>
            </>
          ) : (
            <>
              <Text>{card.glyph}</Text>
              {' '}
              <Text bold>推理</Text>
              {' '}
              <Text dimColor>({duration})</Text>
            </>
          )}
        </Text>
      </Box>

      {/* Content */}
      {!collapsed && !streaming && (
        <Box
          flexDirection="column"
          paddingLeft={2}
          borderStyle="round"
          borderColor={theme.tone.violet}
        >
          {lines.map((line, i) => (
            <Text key={i} dimColor color={theme.fg.sub}>
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Streaming content (always visible during streaming) */}
      {streaming && content && (
        <Box flexDirection="column" paddingLeft={2}>
          {lines.slice(-3).map((line, i) => (
            <Text key={i} dimColor color={theme.fg.meta}>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
