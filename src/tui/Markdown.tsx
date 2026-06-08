// src/tui/Markdown.tsx - Terminal markdown renderer (enhanced)

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
      if (i < lines.length) i++; // skip closing ```

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

    // Table (detect |---| pattern)
    if (line.includes('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
      const headerCells = line.split('|').map(c => c.trim()).filter(Boolean);
      const alignLine = lines[i + 1];
      const aligns = alignLine.split('|').map(c => c.trim()).filter(Boolean).map(c => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      i += 2; // skip header + align
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').map(c => c.trim()).filter(Boolean));
        i++;
      }

      const colWidths = headerCells.map((h, ci) => {
        const max = Math.max(h.length, ...rows.map(r => (r[ci] || '').length));
        return Math.min(max, 30);
      });

      const padCell = (text: string, width: number, align: string) => {
        const t = text.slice(0, width);
        if (align === 'right') return t.padStart(width);
        if (align === 'center') { const p = Math.floor((width - t.length) / 2); return ' '.repeat(p) + t + ' '.repeat(width - p - t.length); }
        return t.padEnd(width);
      };

      const renderRow = (cells: string[], key: string) => (
        <Box key={key}>
          <Text color={theme.fg.faint}>│ </Text>
          {cells.map((cell, ci) => (
            <Text key={ci} color={theme.fg.body}>
              {padCell(cell, colWidths[ci] || 10, aligns[ci] || 'left')}
              <Text color={theme.fg.faint}> │ </Text>
            </Text>
          ))}
        </Box>
      );

      elements.push(<Text key={`th-${elements.length}`} color={theme.fg.faint}>{'─'.repeat(colWidths.reduce((a, b) => a + b + 3, 1))}</Text>);
      elements.push(renderRow(headerCells, `thr-${elements.length}`));
      elements.push(<Text key={`td-${elements.length}`} color={theme.fg.faint}>{'─'.repeat(colWidths.reduce((a, b) => a + b + 3, 1))}</Text>);
      for (let ri = 0; ri < rows.length; ri++) {
        elements.push(renderRow(rows[ri], `tr-${elements.length}`));
      }
      elements.push(<Text key={`tb-${elements.length}`} color={theme.fg.faint}>{'─'.repeat(colWidths.reduce((a, b) => a + b + 3, 1))}</Text>);
      continue;
    }

    // Heading (# ## ### etc) — differentiated by level
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const prefix = level === 1 ? '█ ' : level === 2 ? '▓ ' : level === 3 ? '▒ ' : '  ';
      const color = level <= 2 ? theme.tone.brand : level <= 4 ? theme.tone.accent : theme.fg.body;
      elements.push(
        <Box key={`h-${elements.length}`} marginY={level <= 2 ? 1 : 0}>
          <Text color={color} bold={level <= 4}>{prefix}{headingMatch[2]}</Text>
        </Box>
      );
      i++;
      continue;
    }

    // List item (- * + or 1.)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = Math.floor((listMatch[1]?.length || 0) / 2);
      const bullet = listMatch[2].match(/\d+\./) ? listMatch[2] : '•';
      elements.push(
        <Box key={`li-${elements.length}`} paddingLeft={indent}>
          <Text color={theme.tone.accent}>{bullet} </Text>
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

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <Box key={`bq-${elements.length}`} paddingLeft={1}>
          <Text color={theme.fg.faint}>│ </Text>
          <Text color={theme.fg.sub} italic>{renderInline(line.slice(2), theme)}</Text>
        </Box>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push(
        <Text key={`hr-${elements.length}`} color={theme.fg.faint}>
          {'─'.repeat(40)}
        </Text>
      );
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
 * 渲染行内格式：bold, italic, inline code, links (with URL shown)
 */
function renderInline(text: string, theme: Theme): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Inline code `...`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<Text key={keyIdx++}>{codeMatch[1]}</Text>);
      parts.push(
        <Text key={keyIdx++} color={theme.tone.accent} backgroundColor={theme.tone.violet || '#1e293b'}>
          {codeMatch[2]}
        </Text>
      );
      remaining = codeMatch[3];
      continue;
    }

    // Bold **...**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<Text key={keyIdx++}>{boldMatch[1]}</Text>);
      parts.push(<Text key={keyIdx++} bold>{boldMatch[2]}</Text>);
      remaining = boldMatch[3];
      continue;
    }

    // Strikethrough ~~...~~
    const strikeMatch = remaining.match(/^(.*?)~~(.+?)~~(.*)$/);
    if (strikeMatch) {
      if (strikeMatch[1]) parts.push(<Text key={keyIdx++}>{strikeMatch[1]}</Text>);
      parts.push(<Text key={keyIdx++} strikethrough>{strikeMatch[2]}</Text>);
      remaining = strikeMatch[3];
      continue;
    }

    // Italic *...*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)$/);
    if (italicMatch) {
      if (italicMatch[1]) parts.push(<Text key={keyIdx++}>{italicMatch[1]}</Text>);
      parts.push(<Text key={keyIdx++} italic>{italicMatch[2]}</Text>);
      remaining = italicMatch[3];
      continue;
    }

    // Link [text](url) — show URL in parentheses
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/);
    if (linkMatch) {
      if (linkMatch[1]) parts.push(<Text key={keyIdx++}>{linkMatch[1]}</Text>);
      parts.push(
        <Text key={keyIdx++}>
          <Text color={theme.tone.brand} underline>{linkMatch[2]}</Text>
          <Text color={theme.fg.meta}> ({linkMatch[3]})</Text>
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
