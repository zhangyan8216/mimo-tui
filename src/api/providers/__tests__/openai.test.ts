// src/api/providers/__tests__/openai.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai.js';
import type { Message, ToolDefinition } from '../../types.js';

function mockFetch(response: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(response), { status })
  );
}

function parseBody(spy: ReturnType<typeof vi.spyOn>) {
  const calls = spy.mock.calls;
  return JSON.parse(calls[calls.length - 1][1]!.body as string);
}

describe('OpenAIProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has expected name', () => {
    const provider = new OpenAIProvider('test-key');
    expect(provider.name).toBe('openai');
  });

  it('is not aborted initially', () => {
    const provider = new OpenAIProvider('test-key');
    expect(provider.isAborted).toBe(false);
  });

  it('abort marks provider as aborted', () => {
    const provider = new OpenAIProvider('test-key');
    provider.abort();
    expect(provider.isAborted).toBe(true);
  });

  describe('message conversion (via chat method)', () => {
    const okResponse = {
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    it('sends system message correctly', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await provider.chat([{ role: 'system', content: 'You are helpful.' }]);

      const body = parseBody(spy);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    });

    it('sends user message correctly', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await provider.chat([{ role: 'user', content: 'hello' }]);

      const body = parseBody(spy);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'hello' });
    });

    it('sends assistant message correctly', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await provider.chat([{ role: 'assistant', content: 'I can help.' }]);

      const body = parseBody(spy);
      expect(body.messages[0]).toEqual({ role: 'assistant', content: 'I can help.' });
    });

    it('sends tool message correctly', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await provider.chat([{
        role: 'tool',
        content: 'file contents here',
        tool_call_id: 'call_123',
      }]);

      const body = parseBody(spy);
      expect(body.messages[0]).toEqual({
        role: 'tool',
        content: 'file contents here',
        tool_call_id: 'call_123',
      });
    });

    it('sends assistant message with tool_calls correctly', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await provider.chat([{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"test.ts"}' },
        }],
      }]);

      const body = parseBody(spy);
      expect(body.messages[0].tool_calls).toEqual([{
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"test.ts"}' },
      }]);
    });
  });

  describe('tool definition conversion', () => {
    const okResponse = {
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    it('converts tool definitions to OpenAI format', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      const tools: ToolDefinition[] = [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      }];
      await provider.chat([], tools);

      const body = parseBody(spy);
      expect(body.tools).toEqual([{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      }]);
    });

    it('omits tools when none provided', async () => {
      const spy = mockFetch(okResponse);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await provider.chat([]);

      const body = parseBody(spy);
      expect(body.tools).toBeUndefined();
    });
  });

  describe('chat response parsing', () => {
    it('parses response with tool_calls', async () => {
      mockFetch({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"test.ts"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      const result = await provider.chat([]);

      expect(result.message.tool_calls).toEqual([{
        id: 'call_abc',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"test.ts"}' },
      }]);
    });

    it('parses usage correctly', async () => {
      mockFetch({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      const result = await provider.chat([]);

      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheHitTokens: 0,
        cacheMissTokens: 100,
      });
    });

    it('throws on non-OK response', async () => {
      mockFetch('rate limited', 429);
      const provider = new OpenAIProvider('test-key', 'http://localhost/v1');
      await expect(provider.chat([])).rejects.toThrow('OpenAI API error 429');
    });
  });
});
