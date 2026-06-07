// src/api/providers/gemini.ts - Google Gemini provider adapter

import type { ProviderAdapter, StreamEvent, ChatOptions } from '../provider.js';
import type { Message, ToolDefinition, TokenUsage } from '../types.js';

export class GeminiProvider implements ProviderAdapter {
  readonly name = 'gemini';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta', model: string = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  // Extract system messages and convert remaining to Gemini contents format
  private convertMessages(messages: Message[]): { contents: GeminiContent[]; systemInstruction?: GeminiSystemInstruction } {
    let systemText = '';
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Accumulate system messages into a single system instruction
        systemText += (systemText ? '\n\n' : '') + (msg.content || '');
        continue;
      }

      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content || '' }] });
      } else if (msg.role === 'assistant') {
        const parts: GeminiPart[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch { /* leave as empty object */ }
            parts.push({ functionCall: { name: tc.function.name, args } });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
      } else if (msg.role === 'tool') {
        // Tool results become functionResponse parts in a user message
        let response: Record<string, unknown> = {};
        try {
          response = JSON.parse(msg.content || '{}');
        } catch {
          response = { result: msg.content || '' };
        }
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: msg.name || msg.tool_call_id || 'unknown', response } }],
        });
      }
    }

    // Merge consecutive messages with the same role (Gemini requires alternating roles)
    const merged = this.mergeConsecutiveRoles(contents);

    const result: { contents: GeminiContent[]; systemInstruction?: GeminiSystemInstruction } = { contents: merged };
    if (systemText) {
      result.systemInstruction = { parts: [{ text: systemText }] };
    }
    return result;
  }

  // Gemini requires alternating user/model roles; merge consecutive same-role messages
  private mergeConsecutiveRoles(contents: GeminiContent[]): GeminiContent[] {
    if (contents.length === 0) return contents;
    const merged: GeminiContent[] = [contents[0]];
    for (let i = 1; i < contents.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = contents[i];
      if (prev.role === curr.role) {
        prev.parts.push(...curr.parts);
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }

  private convertTools(tools?: ToolDefinition[]): GeminiToolConfig | undefined {
    if (!tools || tools.length === 0) return undefined;
    return {
      functionDeclarations: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    };
  }

  private buildRequest(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions) {
    const { contents, systemInstruction } = this.convertMessages(messages);
    const body: Record<string, unknown> = { contents };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const toolConfig = this.convertTools(tools);
    if (toolConfig) {
      body.tools = [toolConfig];
    }

    if (options?.maxTokens || options?.temperature !== undefined) {
      const generationConfig: Record<string, unknown> = {};
      if (options?.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;
      if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
      body.generationConfig = generationConfig;
    }

    return body;
  }

  async *streamChat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();

    const body = this.buildRequest(messages, tools, options);
    const url = `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Gemini API error ${response.status}: ${this.formatError(errorText)}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) { yield { type: 'error', error: 'Empty response body' }; return; }

    const decoder = new TextDecoder();
    let buffer = '';
    let toolCallActive = false;
    let toolCallName = '';
    let toolCallArgsAccum = '';
    let toolCallIdx = 0;

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
            const chunk = JSON.parse(data) as GeminiStreamChunk;
            const candidate = chunk.candidates?.[0];
            if (!candidate?.content?.parts) continue;

            for (const part of candidate.content.parts) {
              if ('text' in part && part.text) {
                yield { type: 'text', text: part.text };
              }

              if ('functionCall' in part && part.functionCall) {
                // New tool call starts
                toolCallActive = true;
                toolCallName = part.functionCall.name;
                toolCallArgsAccum = JSON.stringify(part.functionCall.args || {});
                const toolId = `call_${toolCallIdx++}`;
                yield {
                  type: 'tool_use_start',
                  toolId,
                  toolName: toolCallName,
                };
                yield { type: 'tool_use_delta', toolArgsDelta: toolCallArgsAccum };
              }
            }

            // Check for usage metadata
            if (chunk.usageMetadata) {
              yield {
                type: 'usage',
                usage: {
                  promptTokens: chunk.usageMetadata.promptTokenCount || 0,
                  completionTokens: chunk.usageMetadata.candidatesTokenCount || 0,
                  totalTokens: chunk.usageMetadata.totalTokenCount || 0,
                  cacheHitTokens: 0,
                  cacheMissTokens: chunk.usageMetadata.promptTokenCount || 0,
                },
              };
            }

            // Check for finish reason
            if (candidate.finishReason === 'STOP' || candidate.finishReason === 'MAX_TOKENS') {
              // If we were accumulating tool call args, finalize
              if (toolCallActive) {
                toolCallActive = false;
                toolCallArgsAccum = '';
                toolCallName = '';
              }
            }
          } catch { /* skip malformed JSON */ }
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async chat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): Promise<{ message: Message; usage: TokenUsage }> {
    const body = this.buildRequest(messages, tools, options);
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${this.formatError(errorText)}`);
    }

    const result = await response.json() as GeminiStreamChunk;
    const candidate = result.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let content = '';
    const toolCalls: Message['tool_calls'] = [];

    for (const part of parts) {
      if ('text' in part && part.text) {
        content += part.text;
      }
      if ('functionCall' in part && part.functionCall) {
        toolCalls!.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      }
    }

    const usage = result.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

    return {
      message: {
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        promptTokens: usage.promptTokenCount || 0,
        completionTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
        cacheHitTokens: 0,
        cacheMissTokens: usage.promptTokenCount || 0,
      },
    };
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  get isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  // Format Gemini error responses into readable strings
  private formatError(text: string): string {
    try {
      const err = JSON.parse(text);
      if (err.error?.message) return err.error.message;
      if (err.error?.status) return `${err.error.status}: ${err.error.message || 'unknown error'}`;
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  }
}

// ========== Gemini API Types ==========

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiSystemInstruction {
  parts: Array<{ text: string }>;
}

interface GeminiToolConfig {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts: GeminiPart[]; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}
