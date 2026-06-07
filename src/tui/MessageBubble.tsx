// src/tui/MessageBubble.tsx - Card-based message rendering (DeepSeek TUI style)

import React from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';
import type { Message } from '../api/types.js';
import { Markdown } from './Markdown.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCallView } from './ToolCallView.js';

interface StreamingToolCallProps {
  name: string;
  args: string;
  theme: Theme;
}

export const StreamingToolCall: React.FC<StreamingToolCallProps> = ({ name, args, theme }) => {
  const icon = name.startsWith('mcp_') ? '🔌' : '⚡';
  const argsPreview = args.length > 80 ? args.slice(0, 80) + '...' : args;
  return (
    <Box>
      <Text color={theme.tone.brand}>{icon}{' '}</Text>
      <Text color={theme.fg.strong} bold>{name || '...'}{' '}</Text>
      <Text dimColor color={theme.fg.meta}>{argsPreview || '{}'}</Text>
      <Text color={theme.tone.brand} bold>{' '}▊</Text>
    </Box>
  );
};

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
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';

  if (isTool || isSystem) return null;

  const card = isUser ? theme.card.user : theme.card.assistant;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Role header with card glyph */}
      <Box>
        <Text color={card.color} bold>
          {card.glyph} {isUser ? '你' : 'MiMo'}
        </Text>
        {isStreaming && (
          <Text color={theme.tone.brand}> ▸ 传输中</Text>
        )}
      </Box>

      {/* Thinking block */}
      {(thinking || isThinking) && (
        <ThinkingBlock
          content={thinking || ''}
          theme={theme}
          streaming={isThinking}
        />
      )}

      {/* Tool calls */}
      {isAssistant && message.tool_calls && message.tool_calls.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {message.tool_calls.map((tc, i) => {
            const toolResult = toolResults?.get(tc.id);
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments || '{}');
            } catch { /* empty */ }

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

      {/* Content */}
      {message.content && (
        <Box paddingLeft={1} flexDirection="column">
          {isUser ? (
            <Text color={theme.fg.body}>{message.content}</Text>
          ) : (
            <Markdown content={message.content} theme={theme} />
          )}
        </Box>
      )}

      {/* Streaming cursor */}
      {isStreaming && !message.tool_calls?.length && !isThinking && (
        <Box paddingLeft={1}>
          <Text color={theme.tone.brand} bold>▊</Text>
        </Box>
      )}
    </Box>
  );
};
