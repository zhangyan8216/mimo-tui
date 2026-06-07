// src/tools/write-file.ts - Write/create files

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '创建或覆盖写入文件。自动创建父目录。适合创建新文件或完全重写文件。修改已有文件请优先用 edit_file。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径。示例: "src/utils/helper.ts"',
      },
      content: {
        type: 'string',
        description: '要写入的完整文件内容',
      },
    },
    required: ['path', 'content'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = resolvePath(String(args.path), ctx.cwd);
    const validation = ctx.sandbox.validatePath(filePath);
    if (!validation.allowed) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    const content = String(args.content);
    const dir = path.dirname(validation.resolved);
    fs.mkdirSync(dir, { recursive: true });

    const existed = fs.existsSync(validation.resolved);
    fs.writeFileSync(validation.resolved, content, 'utf-8');

    const lines = content.split('\n').length;
    return existed
      ? `Updated ${validation.resolved} (${lines} lines)`
      : `Created ${validation.resolved} (${lines} lines)`;
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
