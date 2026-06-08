// src/agent/__tests__/compact.test.ts
import { describe, it, expect, vi } from 'vitest';
import { estimateTokens, needsCompaction, compactContext } from '../compact.js';
import type { Message } from '../../api/types.js';
import type { ProviderAdapter } from '../../api/provider.js';

describe('estimateTokens', () => {
  it('returns 0 for empty messages', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('estimates tokens for a single text message', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello' }];
    // 5 chars * 1.5 = 7.5, ceil = 8
    expect(estimateTokens(msgs)).toBe(8);
  });

  it('estimates tokens for multiple messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },      // 5 chars
      { role: 'assistant', content: 'world' },  // 5 chars
    ];
    // 10 chars * 1.5 = 15
    expect(estimateTokens(msgs)).toBe(15);
  });

  it('includes tool_calls overhead in estimation', () => {
    const msgs: Message[] = [{
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"src/index.ts"}' },
      }],
    }];
    // tool call: name(9) + args(23) + overhead(20) = 52 chars
    // 52 * 1.5 = 78
    expect(estimateTokens(msgs)).toBe(78);
  });

  it('handles messages with null content', () => {
    const msgs: Message[] = [{ role: 'assistant', content: null }];
    expect(estimateTokens(msgs)).toBe(0);
  });
});

describe('needsCompaction', () => {
  it('returns false for empty messages', () => {
    expect(needsCompaction([])).toBe(false);
  });

  it('returns false for short messages', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello' }];
    expect(needsCompaction(msgs)).toBe(false);
  });

  it('returns true when total chars exceed threshold (200000)', () => {
    // Create a message with > 200000 chars
    const longContent = 'x'.repeat(200001);
    const msgs: Message[] = [{ role: 'user', content: longContent }];
    expect(needsCompaction(msgs)).toBe(true);
  });

  it('returns false when total chars are exactly at threshold', () => {
    const content = 'x'.repeat(200000);
    const msgs: Message[] = [{ role: 'user', content }];
    expect(needsCompaction(msgs)).toBe(false);
  });
});

describe('compactContext', () => {
  function makeMockClient(summary: string): ProviderAdapter {
    return {
      name: 'mock',
      abort: vi.fn(),
      isAborted: false,
      streamChat: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: summary },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cacheHitTokens: 0, cacheMissTokens: 100 },
      }),
    };
  }

  it('returns messages unchanged when <= KEEP_RECENT (8) messages', async () => {
    const msgs: Message[] = Array.from({ length: 8 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i}`,
    }));
    const client = makeMockClient('');
    const result = await compactContext(msgs, client);
    expect(result.compacted).toEqual(msgs);
    expect(result.savedTokens).toBe(0);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('compacts messages when > 8 messages', async () => {
    const msgs: Message[] = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
    }));
    const summary = 'This is a summary of the conversation.';
    const client = makeMockClient(summary);
    const result = await compactContext(msgs, client);

    // Should have 1 summary message + 8 recent messages = 9
    expect(result.compacted.length).toBe(9);
    expect(result.compacted[0].content).toContain('对话摘要');
    expect(result.compacted[0].content).toContain(summary);
    // Last 8 messages preserved
    expect(result.compacted[1]).toEqual(msgs[4]);
    expect(result.compacted[8]).toEqual(msgs[11]);
    expect(result.savedTokens).toBeDefined();
  });

  it('calls onProgress callback', async () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i}`,
    }));
    const client = makeMockClient('summary');
    const onProgress = vi.fn();
    await compactContext(msgs, client, onProgress);
    expect(onProgress).toHaveBeenCalledWith('正在压缩上下文...');
  });

  it('returns original messages on error', async () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i}`,
    }));
    const client: ProviderAdapter = {
      name: 'mock',
      abort: vi.fn(),
      isAborted: false,
      streamChat: vi.fn(),
      chat: vi.fn().mockRejectedValue(new Error('API error')),
    };
    const result = await compactContext(msgs, client);
    expect(result.compacted).toEqual(msgs);
    expect(result.savedTokens).toBe(0);
  });

  it('handles messages with tool_calls in summary formatting', async () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
      tool_calls: i === 3 ? [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{"path":"src/index.ts"}' },
      }] : undefined,
    }));
    const client = makeMockClient('summary with tool info');
    const result = await compactContext(msgs, client);
    expect(result.compacted.length).toBe(9);
    expect(client.chat).toHaveBeenCalledTimes(1);
  });
});
