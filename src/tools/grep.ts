// src/tools/grep.ts - Content search using ripgrep or fallback

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool, ToolContext } from './registry.js';

export const grepTool: Tool = {
  name: 'grep',
  description: '按正则表达式搜索文件内容。优先使用 ripgrep，不可用时回退到内置搜索。用于查找代码中的函数、变量、文本等。',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '正则表达式。示例: "function\\\\s+\\\\w+", "TODO|FIXME", "import.*from"',
      },
      path: {
        type: 'string',
        description: '搜索目录或文件。默认为当前目录',
      },
      glob: {
        type: 'string',
        description: '文件过滤模式。示例: "*.ts", "*.py"',
      },
      case_insensitive: {
        type: 'boolean',
        description: '是否忽略大小写。默认 false',
      },
      max_results: {
        type: 'number',
        description: '最大结果数。默认 50',
      },
    },
    required: ['pattern'],
  },
  requiresApproval: false,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = String(args.pattern);
    const searchPath = args.path ? String(args.path) : ctx.cwd;
    const fileGlob = args.glob ? String(args.glob) : undefined;
    const caseInsensitive = Boolean(args.case_insensitive);
    const maxResults = Number(args.max_results) || 50;

    // Sandbox validation for search path
    const resolvedSearchPath = path.resolve(ctx.cwd, searchPath);
    const validation = ctx.sandbox.validatePath(resolvedSearchPath);
    if (!validation.allowed) {
      throw new Error(`Access denied: ${validation.reason}`);
    }
    const safePath = validation.resolved;

    // Try ripgrep first
    try {
      return await ripgrepSearch(pattern, safePath, fileGlob, caseInsensitive, maxResults);
    } catch {
      // Fallback to built-in search
      return builtinSearch(pattern, safePath, fileGlob, caseInsensitive, maxResults);
    }
  },
};

function ripgrepSearch(
  pattern: string, searchPath: string, fileGlob?: string,
  caseInsensitive?: boolean, maxResults?: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--no-heading', '-n', '--max-count', String(maxResults || 50)];
    if (caseInsensitive) args.push('-i');
    if (fileGlob) args.push('--glob', fileGlob);
    args.push(pattern, searchPath);

    const proc = spawn('rg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 1) {
        resolve('未找到匹配项。');
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr));
        return;
      }
      resolve(stdout.trim() || '未找到匹配项。');
    });

    proc.on('error', reject);
  });
}

function builtinSearch(
  pattern: string, searchPath: string, fileGlob?: string,
  caseInsensitive?: boolean, maxResults?: number
): string {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseInsensitive ? 'gi' : 'g');
  } catch {
    return `无效的正则表达式: ${pattern}`;
  }
  const results: string[] = [];
  const limit = maxResults || 50;

  function searchDir(dir: string): void {
    if (results.length >= limit) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' ||
          entry.name === 'build' || entry.name === 'coverage' || entry.name === '__pycache__' ||
          entry.name === '.next' || entry.name === 'vendor') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        if (fileGlob) {
          if (!matchesGlob(entry.name, fileGlob)) continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= limit) break;
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              const relPath = path.relative(searchPath, fullPath);
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        } catch {
          // Skip binary files
        }
      }
    }
  }

  const stat = fs.statSync(searchPath, { throwIfNoEntry: false });
  if (stat?.isFile()) {
    try {
      const content = fs.readFileSync(searchPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= limit) break;
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          results.push(`${searchPath}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    } catch {
      // Skip
    }
  } else {
    searchDir(searchPath);
  }

  return results.length > 0
    ? results.join('\n')
    : '未找到匹配项。';
}

function matchesGlob(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Handle ** (any path), * (any chars in segment), ? (single char), {a,b} (alternatives)
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * ? { }
    .replace(/\*\*\//g, '(.*/)?')          // **/ matches any leading path
    .replace(/\*\*/g, '.*')                // ** matches anything
    .replace(/\*/g, '[^/]*')               // * matches within a segment
    .replace(/\?/g, '[^/]');               // ? matches single char

  // Handle {a,b} alternatives
  regex = regex.replace(/\{([^}]+)\}/g, (_, alts: string) => {
    return '(' + alts.split(',').map(a => a.trim()).join('|') + ')';
  });

  const re = new RegExp(`^${regex}$`, 'i');
  return re.test(filename);
}
