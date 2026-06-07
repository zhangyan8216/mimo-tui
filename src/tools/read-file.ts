// src/tools/read-file.ts - Read file contents

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取文件内容（带行号）。修改文件前必须先用此工具读取。大文件用 offset+limit 分段读取。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径。示例: "src/index.ts"',
      },
      offset: {
        type: 'number',
        description: '起始行号（从 0 开始）。省略则从头读',
      },
      limit: {
        type: 'number',
        description: '最多读取行数。默认 2000',
      },
    },
    required: ['path'],
  },
  requiresApproval: false,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = resolvePath(String(args.path), ctx.cwd);
    const validation = ctx.sandbox.validatePath(filePath);
    if (!validation.allowed) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    if (!fs.existsSync(validation.resolved)) {
      throw new Error(`File not found: ${validation.resolved}`);
    }

    // 文件大小保护：超过 2MB 的文件拒绝完整读取
    const stat = fs.statSync(validation.resolved);
    if (stat.size > 2 * 1024 * 1024) {
      throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset/limit to read a portion.`);
    }

    const content = fs.readFileSync(validation.resolved, 'utf-8');
    const lines = content.split('\n');
    const offset = Math.max(0, Math.min(Number(args.offset) || 0, lines.length - 1));
    const limit = Math.max(0, Math.min(Number(args.limit) || 2000, lines.length - offset));

    if (limit === 0) {
      return `[文件共 ${lines.length} 行，偏移量 ${offset} 超出范围]`;
    }

    const selectedLines = lines.slice(offset, offset + limit);
    const numbered = selectedLines.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

    const totalLines = lines.length;
    const header = `[第 ${offset + 1}-${Math.min(offset + limit, totalLines)} 行，共 ${totalLines} 行]`;
    const suffix = offset + limit < totalLines
      ? `\n... （还有 ${totalLines - offset - limit} 行，使用 offset 继续读取）`
      : '';

    return `${header}\n${numbered}${suffix}`;
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
