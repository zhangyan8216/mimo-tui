// src/tui/ChatView.tsx - Main chat area with card stream

import React from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';
import type { Message } from '../api/types.js';
import { MessageBubble } from './MessageBubble.js';

interface ChatViewProps {
  messages: Message[];
  theme: Theme;
  streamingContent?: string;
  streamingThinking?: string;
  streamingToolCalls?: Map<number, { name: string; args: string }>;
  isStreaming?: boolean;
  isThinking?: boolean;
  toolResults?: Map<string, { result?: string; error?: string; status: 'running' | 'completed' | 'failed' }>;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages, theme, streamingContent, streamingThinking, streamingToolCalls, isStreaming, isThinking, toolResults,
}) => {
  if (messages.length === 0 && !isStreaming) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        {/* ASCII art logo */}
        <Box marginBottom={1}>
          <Text color={theme.tone.brand} bold>
            {'  ╔═══════════════════════════════════════════╗'}
          </Text>
        </Box>
        <Box>
          <Text color={theme.tone.brand} bold>
            {'  ║       🐱  欢迎使用 Mimo TUI  🐱        ║'}
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={theme.tone.brand} bold>
            {'  ╚═══════════════════════════════════════════╝'}
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={theme.fg.sub}>基于小米 MiMo 的终端 AI 编程助手</Text>
        </Box>

        {/* Quick start hints */}
        <Box flexDirection="column" paddingLeft={4} gap={0}>
          <Text color={theme.fg.meta}>
            {'  '}<Text color={theme.tone.accent} bold>输入消息</Text>
            <Text color={theme.fg.meta}> 开始对话</Text>
          </Text>
          <Text color={theme.fg.meta}>
            {'  '}<Text color={theme.tone.brand}>Ctrl+K</Text>
            <Text color={theme.fg.meta}> 命令面板</Text>
          </Text>
          <Text color={theme.fg.meta}>
            {'  '}<Text color={theme.tone.brand}>Ctrl+R</Text>
            <Text color={theme.fg.meta}> 会话列表</Text>
          </Text>
          <Text color={theme.fg.meta}>
            {'  '}<Text color={theme.tone.brand}>Ctrl+N</Text>
            <Text color={theme.fg.meta}> 新建会话</Text>
          </Text>
          <Text color={theme.fg.meta}>
            {'  '}<Text color={theme.tone.brand}>?</Text>
            <Text color={theme.fg.meta}> 帮助</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg, i) => (
        <MessageBubble
          key={i}
          message={msg}
          theme={theme}
          toolResults={toolResults}
        />
      ))}

      {/* Streaming message */}
      {isStreaming && (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text color={theme.card.assistant.color} bold>
              {theme.card.assistant.glyph} MiMo
            </Text>
            {!streamingContent && !streamingThinking && (!streamingToolCalls || streamingToolCalls.size === 0) && (
              <Text color={theme.tone.brand}> 思考中...</Text>
            )}
          </Box>
          {/* Streaming tool calls with partial arguments */}
          {streamingToolCalls && streamingToolCalls.size > 0 && (
            <Box flexDirection="column" paddingLeft={1}>
              {Array.from(streamingToolCalls.entries()).map(([index, tc]) => {
                const icon = tc.name.startsWith('mcp_') ? '🔌' : '⚡';
                // Show partial args, truncate for display
                const argsPreview = tc.args.length > 60
                  ? tc.args.slice(0, 60) + '...'
                  : tc.args;
                return (
                  <Box key={index}>
                    <Text color={theme.tone.brand}>
                      {icon}{' '}
                    </Text>
                    <Text color={theme.fg.strong} bold>
                      {tc.name || '...'}{' '}
                    </Text>
                    <Text dimColor color={theme.fg.meta}>
                      {argsPreview || '{}'}
                    </Text>
                    <Text color={theme.tone.brand} bold> ▊</Text>
                  </Box>
                );
              })}
            </Box>
          )}
          <MessageBubble
            message={{ role: 'assistant', content: streamingContent || null }}
            theme={theme}
            thinking={streamingThinking}
            isStreaming={true}
            isThinking={isThinking}
            toolResults={toolResults}
          />
        </Box>
      )}
    </Box>
  );
};
