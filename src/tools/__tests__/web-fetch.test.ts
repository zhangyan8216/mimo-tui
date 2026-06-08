// src/tools/__tests__/web-fetch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetchTool } from '../web-fetch.js';
import type { ToolContext } from '../registry.js';

function makeCtx(): ToolContext {
  return {
    cwd: process.cwd(),
    workingDirectory: process.cwd(),
    sandbox: {
      validatePath: vi.fn().mockReturnValue({ allowed: true, resolved: process.cwd() }),
    },
  } as unknown as ToolContext;
}

describe('web_fetch tool', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('has correct tool name', () => {
    expect(webFetchTool.name).toBe('web_fetch');
  });

  it('has requiresApproval set to true', () => {
    expect(webFetchTool.requiresApproval).toBe(true);
  });

  it('has url as required parameter', () => {
    expect(webFetchTool.parameters.required).toContain('url');
  });

  it('fetches content from a URL', async () => {
    const mockBody = 'Hello, world!';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockBody),
    } as Response);

    const result = await webFetchTool.execute(
      { url: 'https://example.com' },
      makeCtx(),
    );

    expect(result).toBe('Hello, world!');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: { 'User-Agent': 'mimo-ai-cli/1.3.1' },
      }),
    );
  });

  it('truncates content exceeding max_length', async () => {
    const longBody = 'a'.repeat(20000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(longBody),
    } as Response);

    const result = await webFetchTool.execute(
      { url: 'https://example.com', max_length: 100 },
      makeCtx(),
    );

    expect(result.length).toBeLessThan(200);
    expect(result).toContain('已截断');
  });

  it('uses default max_length of 10000', async () => {
    const body = 'x'.repeat(15000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(body),
    } as Response);

    const result = await webFetchTool.execute(
      { url: 'https://example.com' },
      makeCtx(),
    );

    expect(result).toContain('已截断');
    expect(result.length).toBeLessThan(15000);
  });

  it('throws on non-OK HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(
      webFetchTool.execute({ url: 'https://example.com/404' }, makeCtx()),
    ).rejects.toThrow('HTTP 404');
  });

  it('throws on server error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(
      webFetchTool.execute({ url: 'https://example.com/500' }, makeCtx()),
    ).rejects.toThrow('HTTP 500');
  });

  it('handles fetch timeout error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    );

    await expect(
      webFetchTool.execute({ url: 'https://example.com' }, makeCtx()),
    ).rejects.toThrow('获取 URL 失败');
  });

  it('handles network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError('fetch failed'),
    );

    await expect(
      webFetchTool.execute({ url: 'https://invalid.test' }, makeCtx()),
    ).rejects.toThrow('fetch failed');
  });

  it('handles unknown error type', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('string error');

    await expect(
      webFetchTool.execute({ url: 'https://example.com' }, makeCtx()),
    ).rejects.toThrow('未知错误');
  });

  it('returns short content without truncation', async () => {
    const shortBody = 'short';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(shortBody),
    } as Response);

    const result = await webFetchTool.execute(
      { url: 'https://example.com' },
      makeCtx(),
    );

    expect(result).toBe('short');
    expect(result).not.toContain('已截断');
  });
});
