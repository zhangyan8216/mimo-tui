// src/tools/glob.ts - File pattern matching

import { glob } from 'glob';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const globTool: Tool = {
  name: 'glob',
  description: 'Find files matching a glob pattern. Returns matching file paths.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match (e.g., "**/*.ts", "src/**/*.test.js")',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (default: current working directory)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 100)',
      },
    },
    required: ['pattern'],
  },
  requiresApproval: false,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = String(args.pattern);
    const searchPath = args.path ? String(args.path) : ctx.cwd;
    const limit = Number(args.limit) || 100;

    const files = await glob(pattern, {
      cwd: searchPath,
      absolute: false,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });

    if (files.length === 0) {
      return `No files found matching pattern: ${pattern}`;
    }

    const limited = files.slice(0, limit);
    const header = files.length > limit
      ? `Found ${files.length} files (showing first ${limit}):\n`
      : `Found ${files.length} file(s):\n`;

    return header + limited.map(f => path.relative(ctx.cwd, path.resolve(searchPath, f))).join('\n');
  },
};
