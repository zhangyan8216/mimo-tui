// src/tools/docker.ts - Docker container operations

import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

const MAX_OUTPUT = 50_000; // 50KB

/** Execute a docker command and return stdout */
function runDockerCommand(command: string, cwd: string, timeout = 60_000): Promise<string> {
  const isWindows = os.platform() === 'win32';

  return new Promise<string>((resolve, reject) => {
    const shell = isWindows ? 'powershell' : 'bash';
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', `try { ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { Write-Error $_; exit 1 }`]
      : ['-c', command];

    const proc = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT) + '\n... (output truncated at 50KB)';
        proc.kill();
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(0, MAX_OUTPUT) + '\n... (stderr truncated at 50KB)';
        proc.kill();
      }
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Docker command timed out after ${timeout}ms`));
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
      reject(new Error(`Failed to execute docker command: ${err.message}`));
    });
  });
}

export const dockerTool: Tool = {
  name: 'docker',
  description: 'Docker 容器操作。支持构建、运行、查看日志、管理容器和镜像。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['build', 'run', 'ps', 'logs', 'stop', 'rm', 'images', 'exec'],
        description: 'Docker 操作: build(构建), run(运行), ps(列出容器), logs(查看日志), stop(停止), rm(删除), images(列出镜像), exec(执行命令)',
      },
      target: {
        type: 'string',
        description: '目标镜像名、容器名或 Dockerfile 路径',
      },
      args: {
        type: 'string',
        description: '额外参数。示例: "-p 3000:3000 --name myapp"',
      },
      command: {
        type: 'string',
        description: 'exec 操作时要执行的命令',
      },
    },
    required: ['action'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action);
    const target = args.target ? String(args.target) : '';
    const extraArgs = args.args ? String(args.args) : '';
    const execCommand = args.command ? String(args.command) : '';
    const isWindows = os.platform() === 'win32';

    // Build the docker command based on action
    let command: string;

    switch (action) {
      case 'build': {
        // Target defaults to current directory name
        const imageName = target || path.basename(ctx.cwd);
        command = `docker build -t ${imageName} .`;
        if (extraArgs) command = `docker build ${extraArgs} -t ${imageName} .`;
        break;
      }

      case 'run': {
        if (!target) {
          return '[Error] run 操作需要指定目标镜像名 (target 参数)';
        }
        command = `docker run ${extraArgs} ${target}`.trim();
        break;
      }

      case 'ps': {
        command = 'docker ps -a';
        if (extraArgs) command = `docker ps -a ${extraArgs}`;
        break;
      }

      case 'logs': {
        if (!target) {
          return '[Error] logs 操作需要指定目标容器名 (target 参数)';
        }
        command = `docker logs ${target} --tail 100`;
        if (extraArgs) command = `docker logs ${extraArgs} ${target} --tail 100`;
        break;
      }

      case 'stop': {
        if (!target) {
          return '[Error] stop 操作需要指定目标容器名 (target 参数)';
        }
        command = `docker stop ${target}`;
        break;
      }

      case 'rm': {
        if (!target) {
          return '[Error] rm 操作需要指定目标容器名 (target 参数)';
        }
        command = `docker rm ${target}`;
        if (extraArgs) command = `docker rm ${extraArgs} ${target}`;
        break;
      }

      case 'images': {
        command = 'docker images';
        if (extraArgs) command = `docker images ${extraArgs}`;
        break;
      }

      case 'exec': {
        if (!target) {
          return '[Error] exec 操作需要指定目标容器名 (target 参数)';
        }
        if (!execCommand) {
          return '[Error] exec 操作需要指定要执行的命令 (command 参数)';
        }
        command = `docker exec ${extraArgs} ${target} ${execCommand}`.trim();
        break;
      }

      default:
        return `[Error] 未知的 Docker 操作: ${action}\n支持的操作: build, run, ps, logs, stop, rm, images, exec`;
    }

    try {
      const result = await runDockerCommand(command, ctx.cwd, 120_000);
      return result;
    } catch (error) {
      return `[Error] Docker 命令执行失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
