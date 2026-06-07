// src/api/provider.ts - Unified provider adapter interface
// Enables multi-model provider support (Anthropic, OpenAI, etc.)

import type { Message, ToolDefinition, TokenUsage } from './types.js';

export interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_use_start' | 'tool_use_delta' | 'usage' | 'error' | 'done';
  text?: string;
  thinking?: string;
  toolId?: string;
  toolName?: string;
  toolArgsDelta?: string;
  usage?: TokenUsage;
  error?: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  thinkingEnabled?: boolean;
  model?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  streamChat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): AsyncGenerator<StreamEvent>;
  chat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): Promise<{ message: Message; usage: TokenUsage }>;
  abort(): void;
  get isAborted(): boolean;
}
