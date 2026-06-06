// src/utils/git.ts - Git 集成工具

import { spawn } from 'child_process';

export interface GitInfo {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  lastCommit: string;
  status: string; // 简短状态摘要
}

/** 执行 git 命令 */
function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', () => resolve(stdout.trim()));
    proc.on('error', () => resolve(''));
  });
}

/** 获取完整 Git 信息 */
export async function getGitInfo(cwd?: string): Promise<GitInfo> {
  const [branch, statusShort, lastCommit, aheadBehind] = await Promise.all([
    git(['branch', '--show-current'], cwd),
    git(['status', '--short'], cwd),
    git(['log', '-1', '--pretty=%h %s', '--no-show-signature'], cwd),
    git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], cwd),
  ]);

  const dirty = statusShort.length > 0;
  let ahead = 0, behind = 0;
  if (aheadBehind) {
    const parts = aheadBehind.split('\t');
    ahead = parseInt(parts[0]) || 0;
    behind = parseInt(parts[1]) || 0;
  }

  const statusParts: string[] = [];
  if (dirty) statusParts.push('有未提交更改');
  if (ahead > 0) statusParts.push(`领先 ${ahead} 个提交`);
  if (behind > 0) statusParts.push(`落后 ${behind} 个提交`);

  return {
    branch: branch || '(非 git 仓库)',
    dirty,
    ahead,
    behind,
    lastCommit: lastCommit || '',
    status: statusParts.join(', ') || '干净',
  };
}

/** 获取 git diff 摘要 */
export async function getGitDiff(cwd?: string): Promise<string> {
  const [staged, unstaged] = await Promise.all([
    git(['diff', '--cached', '--stat'], cwd),
    git(['diff', '--stat'], cwd),
  ]);

  const parts: string[] = [];
  if (staged) parts.push(`已暂存:\n${staged}`);
  if (unstaged) parts.push(`未暂存:\n${unstaged}`);
  return parts.join('\n\n') || '没有更改';
}

/** 获取最近 N 次提交 */
export async function getRecentCommits(n = 5, cwd?: string): Promise<string> {
  return git(['log', `-${n}`, '--pretty=%h %s (%cr)', '--no-show-signature'], cwd);
}
