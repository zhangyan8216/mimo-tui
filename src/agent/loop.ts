// src/agent/loop.ts - Main agent loop (stream → tool → stream)
// Handles Anthropic Messages API streaming format

import type { Message, ToolCall, TokenUsage, AgentMode, AnthropicStreamEvent } from '../api/types.js';
import { MiMoClient } from '../api/client.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { isToolAllowedInMode, needsApproval } from './modes.js';
import { accumulateUsage } from '../utils/tokens.js';
import { log } from '../utils/logger.js';

export interface AgentLoopCallbacks {
  onToken?: (token: string) => void;
  onReasoning?: (token: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, error?: string) => void;
  onToolCallDelta?: (index: number, delta: { name?: string; arguments?: string }) => void;
  onUsage?: (usage: TokenUsage) => void;
  onThinkingStart?: () => void;
  onThinkingEnd?: () => void;
  onError?: (error: Error) => void;
  requestApproval?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

export class AgentLoop {
  private client: MiMoClient;
  private tools: ToolRegistry;
  private toolContext: ToolContext;
  private maxIterations: number;
  private messages: Message[] = [];
  private totalUsage: TokenUsage = {
    promptTokens: 0, completionTokens: 0, totalTokens: 0,
    cacheHitTokens: 0, cacheMissTokens: 0,
  };

  constructor(
    client: MiMoClient,
    tools: ToolRegistry,
    toolContext: ToolContext,
    maxIterations = 32,
  ) {
    this.client = client;
    this.tools = tools;
    this.toolContext = toolContext;
    this.maxIterations = maxIterations;
  }

  async run(
    mode: AgentMode,
    callbacks: AgentLoopCallbacks,
    messages: Message[],
  ): Promise<{ messages: Message[]; usage: TokenUsage }> {
    this.messages = [...messages];
    this.totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;
      log('debug', `Agent loop iteration ${iterations}`);

      const toolDefs = this.getToolsForMode(mode);

      let content = '';
      let reasoning = '';
      const toolCalls: ToolCall[] = [];
      let isThinking = false;
      const activeBlocks = new Map<number, { type: string; toolCallIdx: number }>();

      // Issue #59: 无限重复循环检测
      const recentChunks: string[] = [];
      let repetitionCount = 0;
      const REPETITION_THRESHOLD = 5; // 连续重复 5 次则停止

      try {
        for await (const event of this.client.streamChat(this.messages, toolDefs, {
          reasoningEffort: 'medium',
          thinkingEnabled: true,
        })) {
          // 检查是否被中止
          if (this.client.isAborted) break;

          this.handleStreamEvent(event, {
            onText: (text) => {
              if (isThinking) {
                isThinking = false;
                callbacks.onThinkingEnd?.();
              }
              content += text;
              callbacks.onToken?.(text);

              // 重复检测
              recentChunks.push(text);
              if (recentChunks.length > 20) recentChunks.shift();
              if (detectRepetition(recentChunks, REPETITION_THRESHOLD)) {
                repetitionCount++;
                if (repetitionCount >= REPETITION_THRESHOLD) {
                  log('warn', '检测到无限重复循环，自动停止 (Issue #59)');
                  this.abort();
                }
              }
            },
            onThinking: (text) => {
              if (!isThinking) {
                isThinking = true;
                callbacks.onThinkingStart?.();
              }
              reasoning += text;
              callbacks.onReasoning?.(text);
            },
            onToolUseStart: (blockIndex, toolId, toolName) => {
              // Map this block index to a tool call
              const tcIdx = toolCalls.length;
              toolCalls.push({
                id: toolId,
                type: 'function',
                function: { name: toolName, arguments: '' },
              });
              activeBlocks.set(blockIndex, { type: 'tool_use', toolCallIdx: tcIdx });
            },
            onToolUseDelta: (blockIndex, jsonDelta) => {
              const block = activeBlocks.get(blockIndex);
              if (block && block.type === 'tool_use') {
                toolCalls[block.toolCallIdx].function.arguments += jsonDelta;
                callbacks.onToolCallDelta?.(block.toolCallIdx, { arguments: jsonDelta });
              }
            },
            onUsage: (usage) => {
              this.totalUsage = accumulateUsage(this.totalUsage, usage);
              callbacks.onUsage?.(this.totalUsage);
            },
          });
        }
      } catch (error) {
        if (isThinking) callbacks.onThinkingEnd?.();
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        break;
      }

      if (isThinking) callbacks.onThinkingEnd?.();

      // Issue #59: 重复循环检测 - 截断重复内容
      if (repetitionCount >= REPETITION_THRESHOLD) {
        // 去掉重复的尾部
        const uniqueChunks: string[] = [];
        for (const chunk of recentChunks) {
          if (uniqueChunks.length > 0 && chunk === uniqueChunks[uniqueChunks.length - 1]) continue;
          uniqueChunks.push(chunk);
        }
        content = content.slice(0, content.length - recentChunks.slice(-REPETITION_THRESHOLD * 2).join('').length);
        if (!content) content = '(模型输出重复，已自动截断)';
        log('warn', '已截断重复内容');
      }

      // Build assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: content || null,
      };

      const validToolCalls = toolCalls.filter(tc => tc.function.name);
      if (validToolCalls.length > 0) {
        assistantMsg.tool_calls = validToolCalls;
      }

      this.messages.push(assistantMsg);

      // If no tool calls, we're done
      if (validToolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const tc of validToolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        // Check if tool is allowed in this mode
        if (!isToolAllowedInMode(mode, tc.function.name)) {
          const toolMsg: Message = {
            role: 'tool',
            content: `Error: Tool "${tc.function.name}" is not available in ${mode} mode. Switch to Agent or YOLO mode to use write tools.`,
            tool_call_id: tc.id,
            name: tc.function.name,
          };
          this.messages.push(toolMsg);
          callbacks.onToolResult?.(tc.function.name, '', `Not available in ${mode} mode`);
          continue;
        }

        // Request approval if needed
        if (needsApproval(mode, tc.function.name) && callbacks.requestApproval) {
          const approved = await callbacks.requestApproval(tc.function.name, args);
          if (!approved) {
            const toolMsg: Message = {
              role: 'tool',
              content: 'Operation denied by user.',
              tool_call_id: tc.id,
              name: tc.function.name,
            };
            this.messages.push(toolMsg);
            callbacks.onToolResult?.(tc.function.name, '', 'Denied by user');
            continue;
          }
        }

        callbacks.onToolStart?.(tc.function.name, args);

        const result = await this.tools.execute(tc.function.name, args, this.toolContext);
        result.tool_call_id = tc.id;

        const toolMsg: Message = {
          role: 'tool',
          content: result.error ? `Error: ${result.error}` : result.output,
          tool_call_id: tc.id,
          name: tc.function.name,
        };
        this.messages.push(toolMsg);
        callbacks.onToolResult?.(tc.function.name, result.output, result.error);
      }
    }

    return { messages: this.messages, usage: this.totalUsage };
  }

  /**
   * Handle a single Anthropic streaming event.
   */
  private handleStreamEvent(
    event: AnthropicStreamEvent,
    handlers: {
      onText: (text: string) => void;
      onThinking: (text: string) => void;
      onToolUseStart: (blockIndex: number, toolId: string, toolName: string) => void;
      onToolUseDelta: (blockIndex: number, jsonDelta: string) => void;
      onUsage: (usage: TokenUsage) => void;
    },
  ): void {
    switch (event.type) {
      case 'message_start': {
        // Initial usage from message_start
        if (event.message?.usage) {
          const u = event.message.usage;
          handlers.onUsage({
            promptTokens: u.input_tokens,
            completionTokens: u.output_tokens,
            totalTokens: u.input_tokens + u.output_tokens,
            cacheHitTokens: u.cache_read_input_tokens || 0,
            cacheMissTokens: u.input_tokens - (u.cache_read_input_tokens || 0),
          });
        }
        break;
      }

      case 'content_block_start': {
        const block = event.content_block;
        if (!block || event.index === undefined) break;

        if (block.type === 'thinking') {
          // Thinking block started - will receive deltas
        } else if (block.type === 'tool_use') {
          handlers.onToolUseStart(event.index, block.id || '', block.name || '');
        } else if (block.type === 'text' && block.text) {
          // Initial text (rare, usually comes via deltas)
          handlers.onText(block.text);
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta || event.index === undefined) break;

        if (delta.type === 'thinking_delta' && delta.thinking) {
          handlers.onThinking(delta.thinking);
        } else if (delta.type === 'text_delta' && delta.text) {
          handlers.onText(delta.text);
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          handlers.onToolUseDelta(event.index, delta.partial_json);
        }
        break;
      }

      case 'message_delta': {
        // Final usage update
        if (event.usage) {
          const u = event.usage;
          handlers.onUsage({
            promptTokens: 0, // Already reported in message_start
            completionTokens: u.output_tokens,
            totalTokens: u.output_tokens,
            cacheHitTokens: 0,
            cacheMissTokens: 0,
          });
        }
        break;
      }

      case 'error': {
        log('error', 'Stream error', event.error);
        break;
      }

      // content_block_stop, message_stop - no action needed
    }
  }

  private getToolsForMode(mode: AgentMode) {
    const allDefs = this.tools.getDefinitions();
    if (mode === 'plan') {
      return allDefs.filter(d => isToolAllowedInMode(mode, d.function.name));
    }
    return allDefs;
  }

  get currentUsage(): TokenUsage {
    return this.totalUsage;
  }

  abort(): void {
    this.client.abort();
  }
}

/**
 * 重复循环检测 (Issue #59)
 * 检查最近的文本块是否在重复同一模式
 */
function detectRepetition(chunks: string[], threshold: number): boolean {
  if (chunks.length < 10) return false;

  // 检查最近 N 个 chunk 是否完全相同
  const last = chunks[chunks.length - 1];
  if (!last || last.length < 3) return false;

  let repeatCount = 0;
  for (let i = chunks.length - 2; i >= Math.max(0, chunks.length - threshold * 2); i--) {
    if (chunks[i] === last) repeatCount++;
    else break;
  }

  return repeatCount >= threshold;
}
