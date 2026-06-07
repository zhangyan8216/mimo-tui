// src/tools/edit-file.ts - Edit file with search/replace

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description: '精确替换文件中的文本。修改已有文件的首选工具。必须先用 read_file 读取文件，然后从读取结果中复制 old_string（必须完全一致）。old_string 必须在文件中唯一。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径。示例: "src/App.tsx"',
      },
      old_string: {
        type: 'string',
        description: '要替换的原文。必须与文件内容完全一致（含空格缩进换行）。从 read_file 结果中复制。如不唯一，增加更多上下文行。',
      },
      new_string: {
        type: 'string',
        description: '替换后的新文本。留空 "" 表示删除。',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = resolvePath(String(args.path), ctx.cwd);
    const validation = ctx.sandbox.validatePath(filePath);
    if (!validation.allowed) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    if (!fs.existsSync(validation.resolved)) {
      throw new Error(`File not found: ${validation.resolved}`);
    }

    const content = fs.readFileSync(validation.resolved, 'utf-8');
    const oldStr = String(args.old_string);
    const newStr = String(args.new_string);

    if (!content.includes(oldStr)) {
      throw new Error(`String not found in file:\n${oldStr}`);
    }

    const count = content.split(oldStr).length - 1;
    if (count > 1) {
      throw new Error(`Found ${count} occurrences of the string. It must be unique. Make old_string more specific.`);
    }

    const updated = content.replace(oldStr, newStr);
    fs.writeFileSync(validation.resolved, updated, 'utf-8');

    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;
    return `已编辑 ${validation.resolved}：替换 ${oldLines} 行为 ${newLines} 行`;
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
