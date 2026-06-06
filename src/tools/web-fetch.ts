// src/tools/web-fetch.ts - HTTP fetch tool

import type { Tool, ToolContext } from './registry.js';

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the response body as text.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      max_length: {
        type: 'number',
        description: 'Maximum content length in characters (default: 10000)',
      },
    },
    required: ['url'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const url = String(args.url);
    const maxLength = Number(args.max_length) || 10000;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'mimo-tui/1.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let text = await response.text();
      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + '\n... (truncated)';
      }

      return text;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch URL: ${error.message}`);
      }
      throw new Error('Failed to fetch URL: Unknown error');
    }
  },
};
