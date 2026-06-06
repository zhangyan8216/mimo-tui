// src/tools/edit-file.ts - Edit file with search/replace

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by replacing a specific string. Use for precise, targeted edits.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to search for (must be unique in the file)',
      },
      new_string: {
        type: 'string',
        description: 'The replacement string',
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
    return `Edited ${validation.resolved}: replaced ${oldLines} line(s) with ${newLines} line(s)`;
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
