// src/tools/web-fetch.ts - HTTP fetch tool

import type { Tool, ToolContext } from './registry.js';

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: '获取网页内容，返回文本。用于查阅文档、API 参考、错误信息搜索等。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要获取的 URL。示例: "https://docs.example.com/api"',
      },
      max_length: {
        type: 'number',
        description: '最大返回字符数。默认 10000',
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
        text = text.slice(0, maxLength) + '\n... (已截断)';
      }

      return text;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`获取 URL 失败: ${error.message}`);
      }
      throw new Error('获取 URL 失败: 未知错误');
    }
  },
};
