import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Tool, ToolContext } from './registry.js';

export const codeReviewTool: Tool = {
  name: 'code_review',
  description: '代码审查工具。支持审查 git diff、指定文件、PR 变更。自动检测潜在问题。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['diff', 'file', 'pr', 'staged'],
        description: 'diff: 审查未提交变更, file: 审查指定文件, pr: 审查PR, staged: 审查暂存区',
      },
      target: {
        type: 'string',
        description: '文件路径或 PR 编号 (file/pr action 必填)',
      },
      focus: {
        type: 'string',
        enum: ['bugs', 'security', 'performance', 'style', 'all'],
        description: '审查重点 (默认 all)',
      },
    },
    required: ['action'],
  },
  requiresApproval: false,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || 'diff');
    const target = args.target ? String(args.target) : '';
    const focus = String(args.focus || 'all');

    let diffContent = '';

    switch (action) {
      case 'diff':
        diffContent = execSync('git diff', { cwd: ctx.cwd, encoding: 'utf-8', timeout: 10000 });
        break;
      case 'staged':
        diffContent = execSync('git diff --staged', { cwd: ctx.cwd, encoding: 'utf-8', timeout: 10000 });
        break;
      case 'file':
        if (!target) return '错误: file action 需要 target 参数';
        if (!fs.existsSync(path.join(ctx.cwd, target))) return `错误: 文件不存在: ${target}`;
        {
          const content = fs.readFileSync(path.join(ctx.cwd, target), 'utf-8');
          diffContent = `--- /dev/null\n+++ b/${target}\n${content.split('\n').map(l => '+ ' + l).join('\n')}`;
        }
        break;
      case 'pr':
        if (!target) return '错误: pr action 需要 target 参数 (PR 编号)';
        try {
          diffContent = execSync(`gh pr diff ${target}`, { cwd: ctx.cwd, encoding: 'utf-8', timeout: 15000 });
        } catch {
          return `错误: 无法获取 PR #${target} 的 diff。确保 gh CLI 已安装且已登录。`;
        }
        break;
    }

    if (!diffContent.trim()) return '没有需要审查的变更';

    // Analyze the diff for common issues
    const issues: string[] = [];
    const lines = diffContent.split('\n');
    const addedLines = lines.filter(l => l.startsWith('+') && !l.startsWith('+++'));
    const removedLines = lines.filter(l => l.startsWith('-') && !l.startsWith('---'));

    // Bug patterns
    if (focus === 'bugs' || focus === 'all') {
      for (const line of addedLines) {
        const code = line.slice(1);
        if (code.includes('console.log') && !code.includes('//')) issues.push('⚠️ 遗留 console.log');
        if (code.includes('TODO') || code.includes('FIXME')) issues.push('📝 TODO/FIXME 注释');
        if (code.match(/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/)) issues.push('⚠️ 空 catch 块');
        if (code.includes('any') && code.includes(':')) issues.push('⚠️ 使用了 any 类型');
      }
    }

    // Security patterns
    if (focus === 'security' || focus === 'all') {
      for (const line of addedLines) {
        const code = line.slice(1);
        if (code.includes('eval(')) issues.push('🔴 eval() 调用 - 安全风险');
        if (code.includes('innerHTML')) issues.push('🔴 innerHTML - XSS 风险');
        if (code.match(/password|secret|token|api_key/i) && code.includes('=')) issues.push('🔴 可能的硬编码密钥');
        if (code.includes('http://')) issues.push('⚠️ 使用 HTTP 而非 HTTPS');
      }
    }

    // Performance patterns
    if (focus === 'performance' || focus === 'all') {
      for (const line of addedLines) {
        const code = line.slice(1);
        if (code.includes('Sync(')) issues.push('⚠️ 同步 I/O 操作');
        if (code.includes('JSON.parse') && !code.includes('try')) issues.push('⚠️ JSON.parse 无 try-catch');
      }
    }

    // Format output
    const summary = [
      `🔍 **代码审查** (${action}${target ? ': ' + target : ''})`,
      ``,
      `变更统计: +${addedLines.length} 行 / -${removedLines.length} 行`,
      ``,
    ];

    if (issues.length > 0) {
      summary.push(`**发现 ${issues.length} 个问题:**`);
      const uniqueIssues = [...new Set(issues)];
      for (const issue of uniqueIssues) {
        summary.push(`  ${issue}`);
      }
    } else {
      summary.push('✅ 未发现明显问题');
    }

    summary.push(`\n**建议:** 请将此 diff 提交给 AI 进行深度审查。`);

    return summary.join('\n');
  },
};
