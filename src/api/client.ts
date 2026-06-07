// src/api/client.ts - Anthropic-compatible streaming client for MiMo
// 针对 MiMo 已知问题的容错处理：
//   - 429 限流自动重试 (Issue #55)
//   - tool_use 参数序列化修复 + JSON 修复 (Issue #57 增强)
//   - 流式断连恢复
//   - 系统消息位置修正 (Issue #54)
//   - 自适应推理预算
//   - Prompt cache 优化

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

/**
 * MiMo Issue #57 增强: 修复 MiMo 生成的畸形 JSON
 * 常见问题: 尾部逗号、单引号、未转义换行、注释、缺少括号
 */
export function repairJson(raw: string): string {
  if (!raw || !raw.trim()) return '{}';

  let s = raw.trim();

  // 1. 去掉 BOM 和零宽字符
  s = s.replace(/^﻿/, '').replace(/[​‌‍﻿]/g, '');

  // 2. 去掉行注释 // ... 和块注释 /* ... */
  s = s.replace(/\/\/[^\n]*/g, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');

  // 3. 尝试直接解析
  try { JSON.parse(s); return s; } catch { /* continue */ }

  // 4. 修复单引号字符串 → 双引号 (简单场景)
  // 只处理键值对中的单引号: {'key': 'value'} → {"key": "value"}
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content) => {
    const escaped = content.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return `"${escaped}"`;
  });

  try { JSON.parse(s); return s; } catch { /* continue */ }

  // 5. 修复尾部逗号: {"a":1,} → {"a":1}
  s = s.replace(/,\s*([\]}])/g, '$1');

  // 6. 修复未转义的换行符 (在字符串值内部)
  // 匹配 "..." 中的裸换行并转义
  s = s.replace(/"([^"]*?)"|'([^']*?)'/g, (match, dContent, sContent) => {
    const content = dContent ?? sContent;
    if (content === undefined) return match;
    const fixed = content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return `"${fixed}"`;
  });

  try { JSON.parse(s); return s; } catch { /* continue */ }

  // 7. 修复缺少的闭合括号
  const openBraces = (s.match(/{/g) || []).length;
  const closeBraces = (s.match(/}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/]/g) || []).length;

  if (openBraces > closeBraces) s += '}'.repeat(openBraces - closeBraces);
  if (openBrackets > closeBrackets) s += ']'.repeat(openBrackets - closeBrackets);

  // 8. 去掉 JSON 前面的非 JSON 文本 (MiMo 有时在 JSON 前加解释)
  const jsonStart = s.indexOf('{');
  if (jsonStart > 0) {
    s = s.slice(jsonStart);
    // 再次修复尾部逗号
    s = s.replace(/,\s*([\]}])/g, '$1');
  }

  try { JSON.parse(s); return s; } catch { /* continue */ }

  // 9. 最后手段: 提取第一个完整的 JSON 对象
  const match = s.match(/\{[\s\S]*\}/);
  if (match) {
    let candidate = match[0].replace(/,\s*([\]}])/g, '$1');
    try { JSON.parse(candidate); return candidate; } catch { /* give up */ }
  }

  log('warn', 'JSON 修复失败，返回空对象', { original: raw.slice(0, 100) });
  return '{}';
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
              const raw = tc.function.arguments || '{}';
              // Issue #57: 修复 MiMo 生成的畸形 JSON
              const repaired = repairJson(raw);
              const parsed = JSON.parse(repaired);
              // 确保 input 是对象而非字符串
              input = typeof parsed === 'string' ? JSON.parse(repairJson(parsed)) : parsed;
            } catch (e) {
              log('warn', 'tool_use JSON 解析失败 (Issue #57)', { args: tc.function.arguments?.slice(0, 100), error: String(e) });
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
    return tools.map((t, i) => {
      const tool: AnthropicTool = {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      };
      // 最后一个工具加 cache_control → 缓存全部工具定义
      if (i === tools.length - 1) {
        tool.cache_control = { type: 'ephemeral' };
      }
      return tool;
    });
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

    // MiMo prompt cache 优化
    // 规则: cache_control 放在每个缓存区域的**最后一个** block 上
    // Anthropic API 缓存 breakpoint 之前的所有内容
    if (system) {
      body.system = [
        { type: 'text' as const, text: system },
        // 最后一个空 block 带 cache_control → 缓存整个 system prompt
        { type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } },
      ];
    }
    if (tools && tools.length > 0) body.tools = this.convertTools(tools);

    // 缓存历史消息: 在倒数第 4 条消息上加 cache_control（缓存旧消息）
    if (body.messages.length > 4) {
      const cacheIdx = body.messages.length - 4;
      const cacheMsg = body.messages[cacheIdx];
      if (typeof cacheMsg.content === 'string') {
        cacheMsg.content = [
          { type: 'text' as const, text: cacheMsg.content },
          { type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } },
        ];
      } else if (Array.isArray(cacheMsg.content)) {
        // 在已有 content blocks 末尾追加 cache marker
        cacheMsg.content.push({ type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } });
      }
    }
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
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const statusMsg: Record<number, { msg: string; hint: string }> = {
        400: { msg: '请求格式错误', hint: '可能是工具参数格式不正确，检查 JSON 转义' },
        401: { msg: 'API 密钥无效', hint: '运行 --setup 重新配置，或检查 MIMO_API_KEY 环境变量' },
        403: { msg: '访问被拒绝', hint: 'API 密钥可能过期或没有权限访问该模型' },
        404: { msg: 'API 端点不存在', hint: '检查 base_url 配置，应为 https://token-plan-cn.xiaomimimo.com/anthropic' },
        413: { msg: '请求体过大', hint: '上下文过长，尝试 /compact 压缩或 /clear 清空' },
        429: { msg: '请求过于频繁', hint: '已自动重试。如持续出现，考虑降低请求频率' },
        500: { msg: '服务器内部错误', hint: 'MiMo 服务端问题，稍后重试' },
        503: { msg: '服务不可用', hint: 'MiMo 服务暂时不可用，稍后重试' },
      };
      const info = statusMsg[response.status] || { msg: `API 错误`, hint: '' };
      const hintStr = info.hint ? `\n💡 ${info.hint}` : '';
      throw new Error(`${info.msg} (${response.status})${hintStr}\n${errorText.slice(0, 200)}`);
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
    options?: { temperature?: number; maxTokens?: number; reasoningEffort?: 'low' | 'medium' | 'high'; model?: string }
  ): Promise<{ message: Message; usage: TokenUsage }> {
    const { system, anthropicMessages } = this.convertMessages(messages);

    const body: AnthropicRequest = {
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 8192,
      messages: anthropicMessages,
      stream: false,
    };

    if (system) {
      body.system = [
        { type: 'text' as const, text: system },
        { type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } },
      ];
    }
    if (tools && tools.length > 0) body.tools = this.convertTools(tools);
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    // 缓存历史消息
    if (body.messages.length > 4) {
      const cacheIdx = body.messages.length - 4;
      const cacheMsg = body.messages[cacheIdx];
      if (typeof cacheMsg.content === 'string') {
        cacheMsg.content = [
          { type: 'text' as const, text: cacheMsg.content },
          { type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } },
        ];
      } else if (Array.isArray(cacheMsg.content)) {
        cacheMsg.content.push({ type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } });
      }
    }

    const url = `${this.baseUrl}/v1/messages`;
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const hintMap: Record<number, string> = {
        401: '检查 API 密钥',
        404: '检查 base_url 配置',
        413: '上下文过长，尝试 /compact',
        429: '请求过于频繁，稍后重试',
      };
      const hint = hintMap[response.status] || '';
      throw new Error(`API ${response.status}: ${errorText.slice(0, 200)}${hint ? ` (${hint})` : ''}`);
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
