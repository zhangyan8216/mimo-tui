// src/tools/shell.ts - Execute shell commands

import { spawn } from 'child_process';
import os from 'os';
import type { Tool, ToolContext } from './registry.js';

export const shellTool: Tool = {
  name: 'shell',
  description: 'Execute a shell command. Returns stdout and stderr. Use for running tests, building, git operations, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
      },
    },
    required: ['command'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = String(args.command);
    const timeout = Math.min(Number(args.timeout) || 60000, 300000); // Max 5 minutes
    const isWindows = os.platform() === 'win32';

    return new Promise((resolve, reject) => {
      const shell = isWindows ? 'cmd' : 'bash';
      const shellArgs = isWindows ? ['/c', command] : ['-c', command];

      const proc = spawn(shell, shellArgs, {
        cwd: ctx.cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > 100_000) {
          proc.kill();
          stdout += '\n... (output truncated at 100KB)';
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 50_000) {
          proc.kill();
          stderr += '\n... (stderr truncated at 50KB)';
        }
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const parts: string[] = [];
        if (stdout) parts.push(stdout.trimEnd());
        if (stderr) parts.push(`[STDERR]\n${stderr.trimEnd()}`);
        parts.push(`[Exit code: ${code}]`);
        resolve(parts.join('\n'));
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to execute command: ${err.message}`));
      });
    });
  },
};
