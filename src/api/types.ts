// src/api/types.ts - API types for MiMo Anthropic-compatible client

// ========== Internal Message Types (used throughout the app) ==========

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  output: string;
  error?: string;
}

// ========== Anthropic API Types ==========

// Anthropic message format (what the API accepts)
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string };

// Anthropic tool definition
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// Anthropic API request
export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
  stream?: boolean;
  temperature?: number;
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
  metadata?: { user_id?: string };
}

// Anthropic streaming event types
export interface AnthropicStreamEvent {
  type: string;
  // message_start
  message?: {
    id: string;
    type: string;
    role: string;
    content: unknown[];
    model: string;
    stop_reason: string | null;
    usage: AnthropicUsage;
  };
  // content_block_start
  index?: number;
  content_block?: {
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
  };
  // content_block_delta
  delta?: {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    // tool use input delta
  };
  // message_delta
  usage?: AnthropicUsage;
  // error
  error?: { type: string; message: string };
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Agent mode definitions
export type AgentMode = 'plan' | 'agent' | 'yolo';

// Session types
export interface Session {
  id: string;
  name: string;
  branch: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
  model: string;
  mode: AgentMode;
  messages: Message[];
  token_usage: TokenUsage;
}

// MCP types
export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

// Skill types
export interface Skill {
  name: string;
  description: string;
  path: string;
  content: string;
  triggers?: string[];
}
