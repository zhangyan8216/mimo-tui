// src/tools/read-file.ts - Read file contents

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read (relative to working directory or absolute)',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (0-based)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (default: 2000)',
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

    const content = fs.readFileSync(validation.resolved, 'utf-8');
    const lines = content.split('\n');
    const offset = Math.max(0, Math.min(Number(args.offset) || 0, lines.length - 1));
    const limit = Math.max(0, Math.min(Number(args.limit) || 2000, lines.length - offset));

    if (limit === 0) {
      return `[File has ${lines.length} lines, offset ${offset} is at or past end]`;
    }

    const selectedLines = lines.slice(offset, offset + limit);
    const numbered = selectedLines.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

    const totalLines = lines.length;
    const header = `[Lines ${offset + 1}-${Math.min(offset + limit, totalLines)} of ${totalLines}]`;
    const suffix = offset + limit < totalLines
      ? `\n... (${totalLines - offset - limit} more lines, use offset to read more)`
      : '';

    return `${header}\n${numbered}${suffix}`;
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
