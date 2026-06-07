// src/tui/MessageBubble.tsx - 消息气泡

import React from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';
import type { Message } from '../api/types.js';
import { Markdown } from './Markdown.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCallView } from './ToolCallView.js';

interface MessageBubbleProps {
  message: Message;
  theme: Theme;
  thinking?: string;
  toolResults?: Map<string, { result?: string; error?: string; status: 'running' | 'completed' | 'failed' }>;
  isStreaming?: boolean;
  isThinking?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message, theme, thinking, toolResults, isStreaming, isThinking,
}) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  if (message.role === 'tool' || message.role === 'system') return null;

  return (
    <Box flexDirection="column" marginY={0} paddingY={1}>
      {/* 角色标签 */}
      <Box marginBottom={0}>
        {isUser ? (
          <Text color={theme.tone.accent} bold>  {'>'} 你</Text>
        ) : (
          <Text color={theme.card.assistant.color} bold>  {theme.card.assistant.glyph} MiMo</Text>
        )}
        {isStreaming && (
          <Text color={theme.fg.faint}> · 生成中</Text>
        )}
      </Box>

      {/* 思考块 */}
      {(thinking || isThinking) && (
        <ThinkingBlock content={thinking || ''} theme={theme} streaming={isThinking} />
      )}

      {/* 工具调用 */}
      {isAssistant && message.tool_calls && message.tool_calls.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          {message.tool_calls.map((tc, i) => {
            const toolResult = toolResults?.get(tc.id);
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* skip */ }
            return (
              <ToolCallView
                key={tc.id || i}
                name={tc.function.name}
                args={args}
                result={toolResult?.result}
                error={toolResult?.error}
                status={toolResult?.status || (isStreaming ? 'running' : 'completed')}
                theme={theme}
              />
            );
          })}
        </Box>
      )}

      {/* 消息内容 */}
      {message.content && (
        <Box paddingLeft={2} flexDirection="column">
          {isUser ? (
            <Text color={theme.fg.body}>{message.content}</Text>
          ) : (
            <Markdown content={message.content} theme={theme} />
          )}
        </Box>
      )}

      {/* 流式光标 */}
      {isStreaming && !message.tool_calls?.length && !isThinking && (
        <Box paddingLeft={2}>
          <Text color={theme.tone.brand} bold>▊</Text>
        </Box>
      )}
    </Box>
  );
};
