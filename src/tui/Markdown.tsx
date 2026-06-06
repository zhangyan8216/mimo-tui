// src/tui/Markdown.tsx - Terminal markdown renderer (Claude Code style)

import React from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';

interface MarkdownProps {
  content: string;
  theme: Theme;
}

export const Markdown: React.FC<MarkdownProps> = ({ content, theme }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      elements.push(
        <Box key={`code-${elements.length}`} flexDirection="column" marginY={1} paddingLeft={1} borderStyle="single" borderColor={theme.fg.faint}>
          {lang && <Text dimColor color={theme.fg.meta}>{lang}</Text>}
          {codeLines.map((cl, j) => (
            <Text key={j} color={theme.tone.accent}>{cl}</Text>
          ))}
        </Box>
      );
      continue;
    }

    // Heading (# ## ### etc)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      elements.push(
        <Box key={`h-${elements.length}`} marginY={1}>
          <Text color={theme.tone.brand} bold>{headingMatch[2]}</Text>
        </Box>
      );
      i++;
      continue;
    }

    // List item (- * +)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = Math.floor((listMatch[1]?.length || 0) / 2);
      elements.push(
        <Box key={`li-${elements.length}`} paddingLeft={indent}>
          <Text color={theme.tone.accent}>{'  '.repeat(indent)}• </Text>
          <Text color={theme.fg.body}>{renderInline(listMatch[3], theme)}</Text>
        </Box>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<Text key={`nl-${elements.length}`}>{'\n'}</Text>);
      i++;
      continue;
    }

    // Regular text with inline formatting
    elements.push(
      <Text key={`p-${elements.length}`} color={theme.fg.body}>
        {renderInline(line, theme)}
      </Text>
    );
    i++;
  }

  return <Box flexDirection="column">{elements}</Box>;
};

/**
 * 渲染行内格式：bold, italic, inline code, links
 */
function renderInline(text: string, theme: Theme): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Inline code `...`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/s);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<Text key={keyIdx++}>{codeMatch[1]}</Text>);
      parts.push(
        <Text key={keyIdx++} color={theme.tone.accent} backgroundColor="#1e293b">
          {codeMatch[2]}
        </Text>
      );
      remaining = codeMatch[3];
      continue;
    }

    // Bold **...**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/s);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<Text key={keyIdx++}>{boldMatch[1]}</Text>);
      parts.push(<Text key={keyIdx++} bold>{boldMatch[2]}</Text>);
      remaining = boldMatch[3];
      continue;
    }

    // Italic *...*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)$/s);
    if (italicMatch) {
      if (italicMatch[1]) parts.push(<Text key={keyIdx++}>{italicMatch[1]}</Text>);
      parts.push(<Text key={keyIdx++} italic>{italicMatch[2]}</Text>);
      remaining = italicMatch[3];
      continue;
    }

    // Link [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/s);
    if (linkMatch) {
      if (linkMatch[1]) parts.push(<Text key={keyIdx++}>{linkMatch[1]}</Text>);
      parts.push(
        <Text key={keyIdx++} color={theme.tone.brand} underline>
          {linkMatch[2]}
        </Text>
      );
      remaining = linkMatch[4];
      continue;
    }

    // Plain text
    parts.push(<Text key={keyIdx++}>{remaining}</Text>);
    remaining = '';
  }

  return parts;
}
