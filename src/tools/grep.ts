// src/tools/grep.ts - Content search using ripgrep or fallback

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool, ToolContext } from './registry.js';

export const grepTool: Tool = {
  name: 'grep',
  description: 'Search file contents using regex pattern. Uses ripgrep if available, otherwise falls back to built-in search.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in (default: current directory)',
      },
      glob: {
        type: 'string',
        description: 'File glob pattern to filter (e.g., "*.ts")',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case insensitive search (default: false)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
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

    // Try ripgrep first
    try {
      return await ripgrepSearch(pattern, searchPath, fileGlob, caseInsensitive, maxResults);
    } catch {
      // Fallback to built-in search
      return builtinSearch(pattern, searchPath, fileGlob, caseInsensitive, maxResults);
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
        resolve('No matches found.');
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr));
        return;
      }
      resolve(stdout.trim() || 'No matches found.');
    });

    proc.on('error', reject);
  });
}

function builtinSearch(
  pattern: string, searchPath: string, fileGlob?: string,
  caseInsensitive?: boolean, maxResults?: number
): string {
  const regex = new RegExp(pattern, caseInsensitive ? 'gi' : 'g');
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
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        if (fileGlob) {
          if (!matchesGlob(entry.name, fileGlob)) continue;
        }

        try {
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
    : 'No matches found.';
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
