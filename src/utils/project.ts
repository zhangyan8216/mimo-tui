// src/utils/project.ts - 项目感知工具

import fs from 'fs';
import path from 'path';

export interface ProjectInfo {
  name: string;
  type: string;
  language: string;
  framework: string;
  packageManager: string;
  hasGit: boolean;
  hasTests: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  description: string;
}

/** 检测项目类型和信息 */
export function detectProject(cwd?: string): ProjectInfo {
  const root = cwd || process.cwd();
  const info: ProjectInfo = {
    name: path.basename(root),
    type: '未知',
    language: '未知',
    framework: '',
    packageManager: '',
    hasGit: false,
    hasTests: false,
    hasDocker: false,
    hasCI: false,
    description: '',
  };

  const hasFile = (f: string) => fs.existsSync(path.join(root, f));
  const readFile = (f: string) => {
    try { return fs.readFileSync(path.join(root, f), 'utf-8'); } catch { return ''; }
  };

  // Git
  info.hasGit = hasFile('.git');

  // Docker / CI
  info.hasDocker = hasFile('Dockerfile') || hasFile('docker-compose.yml') || hasFile('docker-compose.yaml');
  info.hasCI = hasFile('.github/workflows') || hasFile('.gitlab-ci.yml') || hasFile('.circleci');

  // Node.js 项目
  if (hasFile('package.json')) {
    const pkg = readFile('package.json');
    try {
      const json = JSON.parse(pkg);
      info.description = json.description || '';
      info.name = json.name || info.name;
    } catch {}

    info.language = 'JavaScript/TypeScript';
    info.packageManager = hasFile('pnpm-lock.yaml') ? 'pnpm' : hasFile('yarn.lock') ? 'yarn' : 'npm';

    // 框架检测
    if (hasFile('next.config.js') || hasFile('next.config.ts') || hasFile('next.config.mjs')) {
      info.framework = 'Next.js';
      info.type = 'Web 应用';
    } else if (hasFile('nuxt.config.ts') || hasFile('nuxt.config.js')) {
      info.framework = 'Nuxt';
      info.type = 'Web 应用';
    } else if (hasFile('vite.config.ts') || hasFile('vite.config.js')) {
      info.framework = 'Vite';
      info.type = 'Web 应用';
    } else if (hasFile('tsconfig.json')) {
      info.framework = 'TypeScript';
      info.type = 'Node.js 项目';
    } else {
      info.type = 'Node.js 项目';
    }

    // 测试
    info.hasTests = hasFile('jest.config.js') || hasFile('jest.config.ts') ||
      hasFile('vitest.config.ts') || hasFile('__tests__') || hasFile('test');

    return info;
  }

  // Python 项目
  if (hasFile('pyproject.toml') || hasFile('setup.py') || hasFile('requirements.txt')) {
    info.language = 'Python';
    info.packageManager = hasFile('poetry.lock') ? 'poetry' : hasFile('uv.lock') ? 'uv' : 'pip';
    if (hasFile('manage.py')) { info.framework = 'Django'; info.type = 'Web 应用'; }
    else if (hasFile('app.py') || hasFile('main.py')) { info.type = 'Python 项目'; }
    info.hasTests = hasFile('tests') || hasFile('test_*.py');
    return info;
  }

  // Go 项目
  if (hasFile('go.mod')) {
    info.language = 'Go';
    info.type = 'Go 项目';
    info.packageManager = 'go mod';
    info.hasTests = hasFile('*_test.go');
    return info;
  }

  // Rust 项目
  if (hasFile('Cargo.toml')) {
    info.language = 'Rust';
    info.type = 'Rust 项目';
    info.packageManager = 'cargo';
    info.hasTests = hasFile('tests');
    return info;
  }

  // Java 项目
  if (hasFile('pom.xml') || hasFile('build.gradle')) {
    info.language = 'Java';
    info.type = 'Java 项目';
    info.packageManager = hasFile('pom.xml') ? 'maven' : 'gradle';
    return info;
  }

  return info;
}

/** 生成项目摘要文本 */
export function formatProjectSummary(info: ProjectInfo): string {
  const parts: string[] = [];
  parts.push(`📁 ${info.name}`);
  if (info.description) parts.push(`   ${info.description}`);
  parts.push(`   语言: ${info.language}`);
  if (info.framework) parts.push(`   框架: ${info.framework}`);
  if (info.packageManager) parts.push(`   包管理: ${info.packageManager}`);
  const flags: string[] = [];
  if (info.hasGit) flags.push('Git');
  if (info.hasTests) flags.push('测试');
  if (info.hasDocker) flags.push('Docker');
  if (info.hasCI) flags.push('CI/CD');
  if (flags.length) parts.push(`   特性: ${flags.join(', ')}`);
  return parts.join('\n');
}
