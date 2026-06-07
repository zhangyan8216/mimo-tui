// src/utils/suggestions.ts - 智能建议（根据上下文自动推荐操作）

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface Suggestion {
  icon: string;
  label: string;
  description: string;
  command: string;
  priority: number;
}

/** 分析当前项目状态，生成智能建议 */
export function generateSuggestions(cwd?: string): Suggestion[] {
  const root = cwd || process.cwd();
  const suggestions: Suggestion[] = [];
  const hasFile = (f: string) => fs.existsSync(path.join(root, f));

  // Git 相关建议
  if (hasFile('.git')) {
    try {
      const status = execSync('git status --short', { cwd: root, encoding: 'utf-8', timeout: 3000 }).trim();
      if (status) {
        suggestions.push({
          icon: '📦',
          label: '有未提交的更改',
          description: `工作区有 ${status.split('\n').length} 个文件变更`,
          command: '/git status',
          priority: 10,
        });
      }
    } catch { /* ignore */ }
  }

  // 测试相关
  if (hasFile('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test) {
        suggestions.push({
          icon: '🧪',
          label: '运行测试',
          description: '项目有测试脚本',
          command: 'npm test',
          priority: 5,
        });
      }
      if (pkg.scripts?.lint) {
        suggestions.push({
          icon: '🔍',
          label: '运行 linter',
          description: '项目有 lint 脚本',
          command: 'npm run lint',
          priority: 4,
        });
      }
    } catch { /* ignore */ }
  }

  // 错误日志
  if (hasFile('error.log') || hasFile('logs/error.log')) {
    suggestions.push({
      icon: '🐛',
      label: '检查错误日志',
      description: '发现错误日志文件',
      command: '/search Error',
      priority: 8,
    });
  }

  // README
  if (!hasFile('README.md') && !hasFile('readme.md')) {
    suggestions.push({
      icon: '📝',
      label: '生成 README',
      description: '项目缺少 README 文件',
      command: '/tpl docs',
      priority: 3,
    });
  }

  // 环境变量
  if (hasFile('.env.example') && !hasFile('.env')) {
    suggestions.push({
      icon: '⚙️',
      label: '配置环境变量',
      description: '有 .env.example 但没有 .env',
      command: '请帮我根据 .env.example 创建 .env 文件',
      priority: 6,
    });
  }

  // 依赖安全
  if (hasFile('package-lock.json') || hasFile('yarn.lock')) {
    suggestions.push({
      icon: '🔒',
      label: '检查依赖安全',
      description: '检查已知漏洞',
      command: 'npm audit',
      priority: 3,
    });
  }

  // 排序
  return suggestions.sort((a, b) => b.priority - a.priority);
}
