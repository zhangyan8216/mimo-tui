// src/tui/ChatView.tsx - 主聊天区域

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
  // 欢迎界面
  if (messages.length === 0 && !isStreaming) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <Box marginBottom={1}>
          <Text color={theme.tone.brand} bold>  🐱  Mimo TUI  </Text>
          <Text color={theme.fg.sub}>v1.2.0</Text>
        </Box>
        <Box marginBottom={2}>
          <Text color={theme.fg.sub}>终端 AI 编程助手</Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          <Box>
            <Text color={theme.fg.faint}>  </Text>
            <Text color={theme.tone.accent} bold>输入消息</Text>
            <Text color={theme.fg.sub}>  开始对话</Text>
          </Box>
          <Box>
            <Text color={theme.fg.faint}>  </Text>
            <Text color={theme.tone.brand}>Ctrl+K</Text>
            <Text color={theme.fg.sub}>  命令面板</Text>
            <Text color={theme.fg.faint}>    </Text>
            <Text color={theme.tone.brand}>Ctrl+R</Text>
            <Text color={theme.fg.sub}>  历史会话</Text>
          </Box>
          <Box>
            <Text color={theme.fg.faint}>  </Text>
            <Text color={theme.tone.brand}>F1</Text>
            <Text color={theme.fg.sub}>       帮助</Text>
            <Text color={theme.fg.faint}>    </Text>
            <Text color={theme.tone.brand}>Tab</Text>
            <Text color={theme.fg.sub}>       命令补全</Text>
          </Box>
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

      {/* 流式输出 */}
      {isStreaming && (
        <Box flexDirection="column" marginY={0} paddingY={1}>
          {/* 工具调用实时显示 */}
          {streamingToolCalls && streamingToolCalls.size > 0 && (
            <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
              {Array.from(streamingToolCalls.entries()).map(([index, tc]) => {
                const argsPreview = tc.args.length > 50 ? tc.args.slice(0, 50) + '…' : tc.args;
                return (
                  <Box key={index}>
                    <Text color={theme.tone.brand}>  ⚡ </Text>
                    <Text color={theme.fg.strong} bold>{tc.name || '…'} </Text>
                    <Text color={theme.fg.faint}>{argsPreview || '{}'}</Text>
                    <Text color={theme.tone.brand} bold> ▊</Text>
                  </Box>
                );
              })}
            </Box>
          )}

          {/* MiMo 回复 */}
          <Box paddingLeft={1}>
            <Text color={theme.card.assistant.color} bold>
              {theme.card.assistant.glyph} MiMo
            </Text>
            {!streamingContent && !streamingThinking && (!streamingToolCalls || streamingToolCalls.size === 0) && (
              <Text color={theme.fg.faint}> 思考中…</Text>
            )}
          </Box>

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
