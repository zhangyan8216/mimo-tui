// src/tui/DiffView.tsx - Code diff rendering using diff library

import React from 'react';
import { Text, Box } from 'ink';
import { diffLines, type Change } from 'diff';
import type { Theme } from './theme.js';

interface DiffViewProps {
  oldText: string;
  newText: string;
  theme: Theme;
  filePath?: string;
}

export const DiffView: React.FC<DiffViewProps> = ({ oldText, newText, theme, filePath }) => {
  const changes: Change[] = diffLines(oldText, newText);

  let added = 0;
  let removed = 0;
  for (const change of changes) {
    const count = (change.value.match(/\n/g) || []).length || 1;
    if (change.added) added += count;
    if (change.removed) removed += count;
  }

  return (
    <Box flexDirection="column" marginY={1} borderStyle="single" borderColor={theme.border}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color={theme.primary} bold>
          {filePath ? `📝 ${filePath}` : '📝 差异'}
        </Text>
        <Text color={theme.muted}>
          <Text color={theme.success}>+{added}</Text>
          {' '}
          <Text color={theme.error}>-{removed}</Text>
        </Text>
      </Box>

      {/* Diff lines */}
      <Box flexDirection="column" paddingX={1}>
        {changes.map((change, i) => {
          const lines = change.value.split('\n').filter((_, idx, arr) =>
            idx < arr.length - 1 || arr[arr.length - 1] !== ''
          );

          return lines.map((line, j) => {
            if (change.added) {
              return (
                <Text key={`${i}-${j}`} color={theme.success}>
                  + {line}
                </Text>
              );
            }
            if (change.removed) {
              return (
                <Text key={`${i}-${j}`} color={theme.error}>
                  - {line}
                </Text>
              );
            }
            return (
              <Text key={`${i}-${j}`} color={theme.muted}>
                {'  '}{line}
              </Text>
            );
          });
        })}
      </Box>
    </Box>
  );
};
