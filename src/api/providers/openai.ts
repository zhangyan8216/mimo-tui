// src/api/providers/openai.ts - OpenAI provider adapter for GPT-4 models

import type { ProviderAdapter, StreamEvent, ChatOptions } from '../provider.js';
import type { Message, ToolDefinition, TokenUsage } from '../types.js';

export class OpenAIProvider implements ProviderAdapter {
  readonly name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private abortController: AbortController | null = null;
  private _aborted = false;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com/v1', model: string = 'gpt-4o') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  // Convert internal messages to OpenAI format
  private convertMessages(messages: Message[]) {
    const result: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const entry: any = { role: 'assistant', content: msg.content };
        if (msg.tool_calls) {
          entry.tool_calls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }));
        }
        result.push(entry);
      } else if (msg.role === 'tool') {
        result.push({ role: 'tool', content: msg.content || '', tool_call_id: msg.tool_call_id || '' });
      }
    }
    return result;
  }

  private convertTools(tools?: ToolDefinition[]) {
    if (!tools) return undefined;
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }

  async *streamChat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): AsyncGenerator<StreamEvent> {
    this.abortController?.abort(); // Abort any existing stream
    this.abortController = new AbortController();
    this._aborted = false;

    const body: any = {
      model: options?.model || this.model,
      messages: this.convertMessages(messages),
      stream: true,
      max_tokens: options?.maxTokens || 4096,
    };

    if (tools && tools.length > 0) body.tools = this.convertTools(tools);
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    // OpenAI doesn't have native thinking, but we can use system prompt hints
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `OpenAI API error ${response.status}: ${errorText.slice(0, 200)}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) { yield { type: 'error', error: 'Empty response body' }; return; }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCallIdx = -1;

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
          if (data === '[DONE]') { yield { type: 'done' }; return; }

          try {
            const event = JSON.parse(data);
            const delta = event.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              yield { type: 'text', text: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== currentToolCallIdx) {
                  currentToolCallIdx = tc.index;
                  yield {
                    type: 'tool_use_start',
                    toolId: tc.id || `call_${tc.index}`,
                    toolName: tc.function?.name || '',
                  };
                }
                if (tc.function?.arguments) {
                  yield { type: 'tool_use_delta', toolArgsDelta: tc.function.arguments };
                }
              }
            }

            if (event.usage) {
              yield {
                type: 'usage',
                usage: {
                  promptTokens: event.usage.prompt_tokens || 0,
                  completionTokens: event.usage.completion_tokens || 0,
                  totalTokens: (event.usage.prompt_tokens || 0) + (event.usage.completion_tokens || 0),
                  cacheHitTokens: event.usage.prompt_tokens_details?.cached_tokens || 0,
                  cacheMissTokens: (event.usage.prompt_tokens || 0) - (event.usage.prompt_tokens_details?.cached_tokens || 0),
                },
              };
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): Promise<{ message: Message; usage: TokenUsage }> {
    const body: any = {
      model: options?.model || this.model,
      messages: this.convertMessages(messages),
      max_tokens: options?.maxTokens || 4096,
    };
    if (tools && tools.length > 0) body.tools = this.convertTools(tools);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const result = await response.json() as any;
    const choice = result.choices?.[0];
    const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })) || [];

    return {
      message: {
        role: 'assistant',
        content: choice?.message?.content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
        totalTokens: (result.usage?.prompt_tokens || 0) + (result.usage?.completion_tokens || 0),
        cacheHitTokens: result.usage?.prompt_tokens_details?.cached_tokens || 0,
        cacheMissTokens: (result.usage?.prompt_tokens || 0) - (result.usage?.prompt_tokens_details?.cached_tokens || 0),
      },
    };
  }

  abort(): void {
    this._aborted = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  get isAborted(): boolean {
    return this._aborted;
  }
}
