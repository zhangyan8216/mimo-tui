// src/api/client.ts - Anthropic-compatible streaming client for MiMo
// 针对 MiMo 已知问题的容错处理：
//   - 429 限流自动重试 (Issue #55)
//   - tool_use 参数序列化修复 (Issue #57)
//   - 流式断连恢复
//   - 系统消息位置修正 (Issue #54)

import type {
  Message,
  ToolDefinition,
  TokenUsage,
  ToolCall,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTool,
  AnthropicRequest,
  AnthropicStreamEvent,
  AnthropicUsage,
} from './types.js';
import { log } from '../utils/logger.js';

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class MiMoClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * 转换内部 Message 格式为 Anthropic Messages 格式
   * 关键：system 消息只放顶层字段，不放 messages 数组 (Issue #54)
   */
  private convertMessages(messages: Message[]): {
    system: string;
    anthropicMessages: AnthropicMessage[];
  } {
    let system = '';
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content || '';
        continue;
      }

      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content || '' });
        continue;
      }

      if (msg.role === 'assistant') {
        const blocks: AnthropicContentBlock[] = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let input: Record<string, unknown> = {};
            try {
              const parsed = JSON.parse(tc.function.arguments || '{}');
              // 修复 Issue #57: 确保 input 是对象而非字符串
              input = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
            } catch {
              input = {};
            }
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
          }
        }
        if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
        anthropicMessages.push({ role: 'assistant', content: blocks });
        continue;
      }

      if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || '',
            content: msg.content || '',
            is_error: msg.content?.startsWith('Error:') || false,
          }],
        });
        continue;
      }
    }

    // 合并连续的 user 消息 (某些 API 要求 user/assistant 交替)
    const merged: AnthropicMessage[] = [];
    for (const msg of anthropicMessages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role && last.role === 'user') {
        // 合并两个 user 消息
        const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content }];
        const curContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content }];
        last.content = [...lastContent, ...curContent];
      } else {
        merged.push(msg);
      }
    }

    return { system, anthropicMessages: merged };
  }

  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  /**
   * 带重试的 fetch 请求 (处理 429/529/500 错误)
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const response = await fetch(url, { ...init, signal: this.abortController?.signal });

        // 成功或客户端错误(非限流) - 直接返回
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          return response;
        }

        // 429 限流 / 529 过载 / 5xx 服务器错误 - 重试
        if (response.status === 429 || response.status === 529 || response.status >= 500) {
          const retryAfter = response.headers.get('retry-after');
          const delay = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.min(RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt), RETRY_CONFIG.maxDelayMs);

          log('warn', `API ${response.status} - 第 ${attempt + 1} 次重试，等待 ${delay}ms`);
          response.body?.cancel(); // 释放连接

          if (attempt < RETRY_CONFIG.maxRetries) {
            await sleep(delay);
            continue;
          }
        }

        return response;
      } catch (err) {
        if (this.abortController?.signal.aborted) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        log('warn', `请求失败 - 第 ${attempt + 1} 次重试`, lastError.message);

        if (attempt < RETRY_CONFIG.maxRetries) {
          await sleep(RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt));
        }
      }
    }

    throw lastError || new Error('请求失败，已重试最大次数');
  }

  /**
   * 流式对话 - 带重试和断连恢复
   */
  async *streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
      thinkingEnabled?: boolean;
    }
  ): AsyncGenerator<AnthropicStreamEvent> {
    this.abortController = new AbortController();

    const { system, anthropicMessages } = this.convertMessages(messages);

    const body: AnthropicRequest = {
      model: this.model,
      max_tokens: options?.maxTokens || 8192,
      messages: anthropicMessages,
      stream: true,
    };

    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = this.convertTools(tools);
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    // Thinking/reasoning
    if (options?.thinkingEnabled === false) {
      body.thinking = { type: 'disabled' };
    } else {
      const budgetMap: Record<string, number> = { low: 5000, medium: 10000, high: 20000 };
      const budget = budgetMap[options?.reasoningEffort || 'medium'] || 10000;
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }

    const url = `${this.baseUrl}/v1/messages`;
    log('debug', 'API 请求', { url, model: this.model, messages: messages.length, tools: tools?.length || 0 });

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // 提供中文友好的错误信息
      const statusMsg: Record<number, string> = {
        400: '请求格式错误',
        401: 'API 密钥无效',
        403: '访问被拒绝',
        404: 'API 端点不存在',
        413: '请求体过大',
        429: '请求过于频繁，已自动重试',
      };
      throw new Error(`${statusMsg[response.status] || 'API 错误'} (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('响应体为空');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;
            yield event;
          } catch {
            // 跳过格式错误的事件
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 非流式对话 - 带重试
   */
  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: { temperature?: number; maxTokens?: number; reasoningEffort?: 'low' | 'medium' | 'high' }
  ): Promise<{ message: Message; usage: TokenUsage }> {
    const { system, anthropicMessages } = this.convertMessages(messages);

    const body: AnthropicRequest = {
      model: this.model,
      max_tokens: options?.maxTokens || 8192,
      messages: anthropicMessages,
      stream: false,
    };

    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = this.convertTools(tools);
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const url = `${this.baseUrl}/v1/messages`;
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 错误 ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const result = (await response.json()) as {
      id: string;
      content: AnthropicContentBlock[];
      stop_reason: string;
      usage: AnthropicUsage;
    };

    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of result.content) {
      if (block.type === 'text') textContent += block.text || '';
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || '',
          type: 'function',
          function: { name: block.name || '', arguments: JSON.stringify(block.input || {}) },
        });
      }
    }

    const usage: TokenUsage = {
      promptTokens: result.usage.input_tokens,
      completionTokens: result.usage.output_tokens,
      totalTokens: result.usage.input_tokens + result.usage.output_tokens,
      cacheHitTokens: result.usage.cache_read_input_tokens || 0,
      cacheMissTokens: result.usage.input_tokens - (result.usage.cache_read_input_tokens || 0),
    };

    return {
      message: { role: 'assistant', content: textContent || null, tool_calls: toolCalls.length > 0 ? toolCalls : undefined },
      usage,
    };
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  get isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }
}
