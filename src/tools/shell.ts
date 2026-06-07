// src/tools/shell.ts - Execute shell commands

import { spawn } from 'child_process';
import os from 'os';
import type { Tool, ToolContext } from './registry.js';

export const shellTool: Tool = {
  name: 'shell',
  description: '执行 shell 命令，返回 stdout 和 stderr。用于运行测试、构建、git 操作、安装依赖等。Windows 自动使用 PowerShell。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的命令。示例: "npm test", "git status", "python -m pytest tests/"',
      },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒），默认 60000，最大 300000',
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
      const shell = isWindows ? 'powershell' : 'bash';
      const shellArgs = isWindows
        ? ['-NoProfile', '-NonInteractive', '-Command', `try { ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { Write-Error $_; exit 1 }`]
        : ['-c', command];

      const proc = spawn(shell, shellArgs, {
        cwd: ctx.cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > 100_000) {
          proc.kill();
          stdout += '\n... (输出在 100KB 处截断)';
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 50_000) {
          proc.kill();
          stderr += '\n... (错误输出在 50KB 处截断)';
        }
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        reject(new Error(`命令执行超时（${timeout}ms）`));
      }, timeout);

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const parts: string[] = [];
        if (stdout) parts.push(stdout.trimEnd());
        if (stderr) parts.push(`[错误输出]\n${stderr.trimEnd()}`);
        parts.push(`[退出码: ${code}]`);
        resolve(parts.join('\n'));
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`命令执行失败：${err.message}`));
      });
    });
  },
};
