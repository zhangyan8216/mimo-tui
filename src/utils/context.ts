// src/utils/context.ts - 智能上下文注入
// 根据用户消息自动注入相关文件、符号、依赖信息

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { log } from './logger.js';
import { AstParser, type ParsedFile } from '../analysis/ast-parser.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', '.mimo']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);

export interface ProjectContext {
  /** 项目根目录的文件树（精简版，只到 2 层深度） */
  fileTree: string;
  /** package.json 的 scripts 和 dependencies */
  packageInfo: string;
  /** tsconfig.json 的关键配置 */
  tsConfig: string;
  /** 最近 git 变更的文件列表 */
  changedFiles: string[];
  /** README 摘要（前 500 字符） */
  readmeSummary: string;
}

/**
 * 构建项目上下文（启动时调用一次，缓存结果）
 */
export function buildProjectContext(cwd: string): ProjectContext {
  const ctx: ProjectContext = {
    fileTree: buildFileTree(cwd),
    packageInfo: extractPackageInfo(cwd),
    tsConfig: extractTsConfig(cwd),
    changedFiles: [],
    readmeSummary: extractReadmeSummary(cwd),
  };

  // 异步获取 git 变更文件
  try {
    const output = execSync('git diff --name-only HEAD 2>nul || git status --short 2>nul', {
      cwd, encoding: 'utf-8', timeout: 5000,
    });
    ctx.changedFiles = output.trim().split('\n').filter(Boolean).slice(0, 20);
  } catch { /* no git or not a repo */ }

  return ctx;
}

/**
 * 根据用户消息提取相关文件路径，返回需要注入的上下文
 */
export function extractRelevantContext(
  userMessage: string,
  cwd: string,
  projectCtx: ProjectContext,
): string {
  const parts: string[] = [];

  // 1. 从用户消息中提取文件路径引用
  const fileRefs = extractFileReferences(userMessage);
  if (fileRefs.length > 0) {
    for (const ref of fileRefs.slice(0, 5)) {
      const resolved = path.resolve(cwd, ref);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        try {
          const stat = fs.statSync(resolved);
          if (stat.size < 50000) { // 只注入小文件
            const content = fs.readFileSync(resolved, 'utf-8');
            const lines = content.split('\n').length;
            parts.push(`### ${ref} (${lines} 行)\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\``);
          }
        } catch { /* skip */ }
      }
    }
  }

  // 2. 从用户消息中提取函数/类名引用，查找定义
  const symbolRefs = extractSymbolReferences(userMessage);
  if (symbolRefs.length > 0) {
    for (const sym of symbolRefs.slice(0, 3)) {
      const def = findSymbolDefinition(sym, cwd);
      if (def) {
        parts.push(`### ${sym} 定义位置\n${def}`);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * 构建精简文件树（2 层深度）
 */
function buildFileTree(cwd: string): string {
  const lines: string[] = [];

  function walk(dir: string, depth: number, prefix: string) {
    if (depth > 2 || lines.length > 100) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    // 排序：目录在前，文件在后
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    // 过滤
    entries = entries.filter(e => {
      if (SKIP_DIRS.has(e.name)) return false;
      if (e.name.startsWith('.') && e.name !== '.env.example') return false;
      if (depth === 0 && e.name === 'package-lock.json') return false;
      return true;
    });

    for (const entry of entries) {
      if (lines.length > 100) break;
      const isDir = entry.isDirectory();
      const icon = isDir ? '📁' : '📄';
      lines.push(`${prefix}${icon} ${entry.name}${isDir ? '/' : ''}`);
      if (isDir) {
        walk(path.join(dir, entry.name), depth + 1, prefix + '  ');
      }
    }
  }

  walk(cwd, 0, '');
  return lines.join('\n');
}

/**
 * 提取 package.json 关键信息
 */
function extractPackageInfo(cwd: string): string {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) return '';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const parts: string[] = [];

    if (pkg.name) parts.push(`名称: ${pkg.name}`);
    if (pkg.description) parts.push(`描述: ${pkg.description}`);

    if (pkg.scripts) {
      const scripts = Object.entries(pkg.scripts)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      parts.push(`脚本:\n${scripts}`);
    }

    const deps = Object.keys(pkg.dependencies || {});
    const devDeps = Object.keys(pkg.devDependencies || {});
    if (deps.length > 0) parts.push(`依赖 (${deps.length}): ${deps.slice(0, 15).join(', ')}${deps.length > 15 ? '...' : ''}`);
    if (devDeps.length > 0) parts.push(`开发依赖 (${devDeps.length}): ${devDeps.slice(0, 10).join(', ')}`);

    return parts.join('\n');
  } catch { return ''; }
}

/**
 * 提取 tsconfig.json 关键配置
 */
function extractTsConfig(cwd: string): string {
  try {
    const tsPath = path.join(cwd, 'tsconfig.json');
    if (!fs.existsSync(tsPath)) return '';
    const ts = JSON.parse(fs.readFileSync(tsPath, 'utf-8'));
    const compiler = ts.compilerOptions || {};
    const parts: string[] = [];
    if (compiler.target) parts.push(`target: ${compiler.target}`);
    if (compiler.module) parts.push(`module: ${compiler.module}`);
    if (compiler.strict) parts.push(`strict: true`);
    if (compiler.jsx) parts.push(`jsx: ${compiler.jsx}`);
    return parts.join(', ');
  } catch { return ''; }
}

/**
 * 提取 README 摘要
 */
function extractReadmeSummary(cwd: string): string {
  for (const name of ['README.md', 'readme.md', 'README.rst', 'README']) {
    try {
      const p = path.join(cwd, name);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        return content.slice(0, 500);
      }
    } catch { /* skip */ }
  }
  return '';
}

/**
 * 从文本中提取文件路径引用
 */
function extractFileReferences(text: string): string[] {
  const patterns = [
    /(?:^|\s)([\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|json|md|yaml|yml|toml|css|html))(?:\s|$|,|:)/gm,
    /(?:文件|file|路径|path)[:\s]+([\w./\\-]+)/gi,
  ];
  const refs = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      refs.add(match[1]);
    }
  }
  return Array.from(refs);
}

/**
 * 从文本中提取函数/类名引用
 */
function extractSymbolReferences(text: string): string[] {
  // 匹配可能的函数/类名：CamelCase 或 camelCase
  const matches = text.match(/\b[A-Z][a-zA-Z0-9]+(?:Manager|Client|Store|Service|Controller|Component|Helper|Util|Tool|Config)\b/g);
  if (!matches) return [];
  return [...new Set(matches)].slice(0, 5);
}

/**
 * 查找符号定义位置（优先使用 AST 解析，回退到正则匹配）
 */
function findSymbolDefinition(symbol: string, cwd: string): string | null {
  // 优先使用 AST 解析
  try {
    const parser = new AstParser(cwd);
    parser.initialize();

    const filePaths = collectSourceFiles(cwd);
    const parsedFiles: ParsedFile[] = [];
    for (const fp of filePaths) {
      const parsed = parser.parseFile(fp);
      if (parsed) parsedFiles.push(parsed);
    }

    const matches = parser.findSymbol(symbol, parsedFiles);
    if (matches.length > 0) {
      // 优先返回 exported 的，否则返回第一个匹配
      const match = matches[0];
      return `${path.relative(cwd, match.filePath)}:${match.line} → ${match.exported ? 'export ' : ''}${match.kind} ${match.name}`;
    }
  } catch (err) {
    log('debug', `AST symbol lookup failed for "${symbol}", falling back to regex: ${err}`);
  }

  // 回退到正则匹配
  return findSymbolDefinitionRegex(symbol, cwd);
}

/**
 * 收集源文件列表
 */
function collectSourceFiles(dir: string, maxFiles = 200): string[] {
  const results: string[] = [];

  function walk(current: string) {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * 正则匹配回退方案
 */
function findSymbolDefinitionRegex(symbol: string, cwd: string): string | null {
  const searchDirs = ['src', 'lib', '.'];
  for (const dir of searchDirs) {
    const fullDir = path.join(cwd, dir);
    if (!fs.existsSync(fullDir)) continue;

    try {
      const files = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !SOURCE_EXTS.has(path.extname(file.name))) continue;
        const filePath = path.join(fullDir, file.name);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          // 查找 export class/interface/function/type + symbol
          const regex = new RegExp(`(?:export\\s+)?(?:class|interface|function|type|const|enum)\\s+${symbol}\\b`);
          const match = content.match(regex);
          if (match) {
            const lineNum = content.substring(0, match.index).split('\n').length;
            return `${path.relative(cwd, filePath)}:${lineNum} → ${match[0].trim()}`;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return null;
}
