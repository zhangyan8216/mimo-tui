// src/tools/codebase.ts - Codebase intelligence tool

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';
import { analyzeDependencies, formatDepAnalysis } from '../analysis/deps-analyzer.js';
import { AstParser, type ParsedFile } from '../analysis/ast-parser.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'out', '.next', '__pycache__', '.cache']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

interface FileInfo {
  path: string;
  lines: number;
  symbols: SymbolInfo[];
  imports: string[];
}

interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'default' | 'enum' | 'variable';
  line: number;
  exported: boolean;
}

// Symbol regex patterns
const SYMBOL_PATTERNS: Array<{ regex: RegExp; kind: SymbolInfo['kind'] }> = [
  { regex: /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g, kind: 'function' },
  { regex: /export\s+(?:abstract\s+)?class\s+(\w+)/g, kind: 'class' },
  { regex: /export\s+interface\s+(\w+)/g, kind: 'interface' },
  { regex: /export\s+type\s+(\w+)/g, kind: 'type' },
  { regex: /export\s+enum\s+(\w+)/g, kind: 'enum' },
  { regex: /export\s+(?:const|let|var)\s+(\w+)/g, kind: 'const' },
  { regex: /export\s+default\s+(?:class|function)\s+(\w+)/g, kind: 'default' },
  { regex: /export\s+default\s+(\w+)/g, kind: 'default' },
  // Non-exported declarations (for completeness)
  { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
  { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  { regex: /^(?:export\s+)?interface\s+(\w+)/gm, kind: 'interface' },
  { regex: /^(?:export\s+)?type\s+(\w+)/gm, kind: 'type' },
];

const IMPORT_REGEX = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_DEFAULT_REGEX = /export\s+default\s+/g;

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTS.has(path.extname(filePath).toLowerCase());
}

function collectFiles(dir: string, maxFiles = 500): string[] {
  const results: string[] = [];

  function walk(current: string) {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // Permission denied or similar
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.name.startsWith('.') && entry.name !== '.mimo') continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function analyzeFile(filePath: string, cwd: string): FileInfo | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relPath = path.relative(cwd, filePath).replace(/\\/g, '/');
    const symbols: SymbolInfo[] = [];
    const imports: string[] = [];
    const seenSymbols = new Set<string>();

    // Find symbols
    for (const { regex, kind } of SYMBOL_PATTERNS) {
      // Reset regex state
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        const key = `${name}:${kind}`;
        if (seenSymbols.has(key)) continue;
        seenSymbols.add(key);

        const lineNum = content.substring(0, match.index).split('\n').length;
        const exported = /export/.test(match[0]);
        symbols.push({ name, kind, line: lineNum, exported });
      }
    }

    // Find imports
    const seenImports = new Set<string>();
    for (const regex of [IMPORT_REGEX, REQUIRE_REGEX]) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const source = match[1];
        if (!seenImports.has(source)) {
          seenImports.add(source);
          imports.push(source);
        }
      }
    }

    return { path: relPath, lines: lines.length, symbols, imports };
  } catch {
    return null;
  }
}

function resolveImportPath(importSource: string, fromFile: string, allFiles: string[]): string | null {
  if (!importSource.startsWith('.') && !importSource.startsWith('..')) return null;

  const dir = path.dirname(fromFile);
  const resolved = path.normalize(path.join(dir, importSource));

  // Try exact match with extensions
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
    const candidate = resolved + ext;
    const normalized = candidate.replace(/\\/g, '/');
    const found = allFiles.find(f => f === normalized || f.endsWith(normalized));
    if (found) return found;
  }

  return null;
}

function formatIndex(files: FileInfo[]): string {
  const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
  const exportedSymbols = files.flatMap(f =>
    f.symbols.filter(s => s.exported).map(s => `${f.path}: ${s.kind} ${s.name}`)
  );

  // Find entry points (files named index, main, app, server, cli)
  const entryPatterns = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js', 'cli.ts', 'cli.js'];
  const entryPoints = files.filter(f =>
    entryPatterns.some(p => f.path.endsWith(p) || f.path.endsWith('/' + p))
  );

  const lines: string[] = [
    `项目索引`,
    `============`,
    `文件: ${files.length}`,
    `总行数: ${totalLines}`,
    `导出符号: ${exportedSymbols.length}`,
    '',
  ];

  if (entryPoints.length > 0) {
    lines.push('入口文件:');
    for (const ep of entryPoints) {
      lines.push(`  ${ep.path} (${ep.lines} 行)`);
    }
    lines.push('');
  }

  // Group files by directory
  const byDir = new Map<string, FileInfo[]>();
  for (const f of files) {
    const dir = path.dirname(f.path) || '.';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }

  lines.push('目录结构:');
  const dirs = [...byDir.keys()].sort();
  for (const dir of dirs.slice(0, 30)) {
    const dirFiles = byDir.get(dir)!;
    const dirLines = dirFiles.reduce((sum, f) => sum + f.lines, 0);
    lines.push(`  ${dir}/ (${dirFiles.length} 个文件, ${dirLines} 行)`);
  }

  if (exportedSymbols.length > 0) {
    lines.push('');
    lines.push('主要导出符号:');
    for (const sym of exportedSymbols.slice(0, 50)) {
      lines.push(`  ${sym}`);
    }
    if (exportedSymbols.length > 50) {
      lines.push(`  ...还有 ${exportedSymbols.length - 50} 个`);
    }
  }

  return lines.join('\n');
}

function formatSymbols(target: string, allFiles: FileInfo[]): string {
  const matchingFiles = target.includes('*') || target.includes('/') || target.includes('\\')
    ? allFiles.filter(f => f.path.includes(target.replace(/\\/g, '/')))
    : allFiles;

  const results: string[] = [];

  for (const file of matchingFiles) {
    const relevantSymbols = file.symbols.filter(s => {
      if (target.includes('*') || target.includes('/')) return true;
      // Search by symbol name
      return s.name.toLowerCase().includes(target.toLowerCase());
    });

    if (relevantSymbols.length > 0) {
      results.push(`\n${file.path}:`);
      for (const sym of relevantSymbols) {
        const exportTag = sym.exported ? 'export ' : '';
        results.push(`  L${sym.line}: ${exportTag}${sym.kind} ${sym.name}`);
      }
    }
  }

  if (results.length === 0) {
    return `未找到匹配的符号: ${target}`;
  }

  const header = `符号定义匹配 "${target}":`;
  return header + results.join('\n');
}

function formatDeps(filePath: string, allFiles: FileInfo[]): string {
  const normalizedTarget = filePath.replace(/\\/g, '/');
  const file = allFiles.find(f => f.path === normalizedTarget || f.path.endsWith('/' + normalizedTarget));

  if (!file) {
    return `索引中未找到文件: ${filePath}。请先运行 'index' 操作。`;
  }

  const lines: string[] = [
    `Dependency graph for: ${file.path}`,
    `================================${'='.repeat(file.path.length)}`,
    '',
  ];

  // What this file imports
  lines.push('导入:');
  if (file.imports.length === 0) {
    lines.push('  （无）');
  } else {
    for (const imp of file.imports) {
      const resolved = resolveImportPath(imp, file.path, allFiles.map(f => f.path));
      const localTag = resolved ? ' [本地]' : ' [外部]';
      lines.push(`  ${imp}${localTag}`);
    }
  }

  lines.push('');

  // What imports this file
  const importers: string[] = [];
  const targetBase = file.path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
  for (const other of allFiles) {
    if (other.path === file.path) continue;
    for (const imp of other.imports) {
      const resolved = resolveImportPath(imp, other.path, allFiles.map(f => f.path));
      if (resolved === file.path) {
        importers.push(other.path);
        break;
      }
    }
  }

  lines.push('被引用:');
  if (importers.length === 0) {
    lines.push('  （项目中未找到引用）');
  } else {
    for (const imp of importers.slice(0, 30)) {
      lines.push(`  ${imp}`);
    }
    if (importers.length > 30) {
      lines.push(`  ...还有 ${importers.length - 30} 个`);
    }
  }

  return lines.join('\n');
}

function formatRelated(filePath: string, allFiles: FileInfo[]): string {
  const normalizedTarget = filePath.replace(/\\/g, '/');
  const file = allFiles.find(f => f.path === normalizedTarget || f.path.endsWith('/' + normalizedTarget));

  if (!file) {
    return `索引中未找到文件: ${filePath}。请先运行 'index' 操作。`;
  }

  const lines: string[] = [
    `Files related to: ${file.path}`,
    `================================${'='.repeat(file.path.length)}`,
    '',
  ];

  // Same directory
  const fileDir = path.dirname(file.path);
  const sameDir = allFiles
    .filter(f => path.dirname(f.path) === fileDir && f.path !== file.path)
    .map(f => f.path);
  if (sameDir.length > 0) {
    lines.push('同一目录:');
    for (const f of sameDir.slice(0, 15)) {
      lines.push(`  ${f}`);
    }
    lines.push('');
  }

  // Shared imports (files that import the same local modules)
  const localImports = file.imports.filter(i => i.startsWith('.'));
  if (localImports.length > 0) {
    const sharedFiles = new Map<string, number>();
    for (const other of allFiles) {
      if (other.path === file.path) continue;
      const otherLocal = other.imports.filter(i => i.startsWith('.'));
      const shared = localImports.filter(i => otherLocal.includes(i));
      if (shared.length > 0) {
        sharedFiles.set(other.path, shared.length);
      }
    }

    const sorted = [...sharedFiles.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      lines.push('共同导入（具有相同依赖的文件）:');
      for (const [f, count] of sorted.slice(0, 10)) {
        lines.push(`  ${f} (${count} shared)`);
      }
      lines.push('');
    }
  }

  // Similar names (same base name in different dirs, or same prefix)
  const baseName = path.basename(file.path, path.extname(file.path));
  const similarNames = allFiles
    .filter(f => {
      if (f.path === file.path) return false;
      const fBase = path.basename(f.path, path.extname(f.path));
      return fBase === baseName || fBase.startsWith(baseName + '.') || baseName.startsWith(fBase + '.');
    })
    .map(f => f.path);

  if (similarNames.length > 0) {
    lines.push('相似文件名:');
    for (const f of similarNames.slice(0, 10)) {
      lines.push(`  ${f}`);
    }
  }

  return lines.join('\n');
}

export const codebaseTool: Tool = {
  name: 'codebase',
  description: `代码库分析工具。**收到新任务时应首先调用此工具**了解项目结构。
- index: 扫描项目，返回文件数、行数、入口文件、导出符号
- symbols: 查找符号定义。示例: {"action":"symbols","target":"App"}
- ast-symbols: AST 精确符号查找。示例: {"action":"ast-symbols","target":"App"}
- deps: 文件依赖关系。示例: {"action":"deps","target":"src/App.tsx"}
- related: 相关文件。示例: {"action":"related","target":"src/App.tsx"}
- deps-analysis: 项目依赖分析，检测未使用和未声明的依赖。示例: {"action":"deps-analysis"}`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['index', 'symbols', 'ast-symbols', 'deps', 'related', 'deps-analysis'],
        description: '子命令: index(扫描), symbols(符号查找), ast-symbols(AST精确符号查找), deps(依赖图), related(关联文件), deps-analysis(依赖分析)',
      },
      target: {
        type: 'string',
        description: '文件路径或符号名。symbols: "App" 查找 App 的定义; deps/related: "src/App.tsx" 查看该文件',
      },
      path: {
        type: 'string',
        description: '扫描根目录。默认为当前工作目录',
      },
    },
    required: ['action'],
  },
  requiresApproval: false,

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action);
    const target = args.target ? String(args.target) : undefined;
    const rootDir = args.path ? String(args.path) : ctx.cwd;

    // Collect and analyze files
    const filePaths = collectFiles(rootDir);
    if (filePaths.length === 0) {
      return '项目中未找到源文件。';
    }

    const allFiles: FileInfo[] = [];
    for (const fp of filePaths) {
      const info = analyzeFile(fp, rootDir);
      if (info) allFiles.push(info);
    }

    switch (action) {
      case 'index':
        return formatIndex(allFiles);

      case 'symbols':
        if (!target) {
          return '错误: "target" 参数在 symbols 操作中是必需的。请提供文件路径或符号名称。';
        }
        return formatSymbols(target, allFiles);

      case 'ast-symbols': {
        const parser = new AstParser(rootDir);
        parser.initialize();
        const filePaths = collectFiles(rootDir);
        const parsedFiles: ParsedFile[] = [];
        for (const fp of filePaths) {
          const parsed = parser.parseFile(fp);
          if (parsed) parsedFiles.push(parsed);
        }
        const searchTarget = target || '';
        const results: string[] = [];
        for (const file of parsedFiles) {
          const matched = file.symbols.filter(s =>
            !searchTarget || s.name.toLowerCase().includes(searchTarget.toLowerCase())
          );
          if (matched.length > 0) {
            results.push(`\n${path.relative(rootDir, file.filePath)}:`);
            for (const sym of matched) {
              results.push(`  L${sym.line}: ${sym.exported ? 'export ' : ''}${sym.kind} ${sym.name}`);
            }
          }
        }
        return results.length > 0 ? `AST 符号查找 "${searchTarget}":\n${results.join('\n')}` : `未找到匹配 "${searchTarget}" 的符号`;
      }

      case 'deps':
        if (!target) {
          return '错误: "target" 参数在 deps 操作中是必需的。请提供文件路径。';
        }
        return formatDeps(target, allFiles);

      case 'related':
        if (!target) {
          return '错误: "target" 参数在 related 操作中是必需的。请提供文件路径。';
        }
        return formatRelated(target, allFiles);

      case 'deps-analysis':
        const depAnalysis = analyzeDependencies(rootDir);
        return formatDepAnalysis(depAnalysis);

      default:
        return `错误: 未知操作 "${action}"。有效操作: index, symbols, ast-symbols, deps, related, deps-analysis`;
    }
  },
};
