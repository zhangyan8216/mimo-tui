import fs from 'fs';
import path from 'path';

export interface DepAnalysis {
  declared: { deps: string[]; devDeps: string[] };
  used: string[];
  unused: string[];
  undeclared: string[];
}

// Node.js builtin modules
const builtinModules = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

export function analyzeDependencies(cwd: string): DepAnalysis {
  // 1. Read package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { declared: { deps: [], devDeps: [] }, used: [], unused: [], undeclared: [] };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  const allDeclared = new Set([...deps, ...devDeps]);

  // 2. Scan all source files for imports
  const usedPackages = new Set<string>();
  const srcDirs = ['src', 'lib', 'app', 'pages', 'components', '.'];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
  const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && sourceExts.has(path.extname(entry.name))) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          // Match: import ... from 'package'
          const importRegex = /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
          // Match: require('package')
          const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
          for (const regex of [importRegex, requireRegex]) {
            let match;
            while ((match = regex.exec(content)) !== null) {
              const spec = match[1];
              // Extract package name (handle scoped packages)
              const pkgName = spec.startsWith('@')
                ? spec.split('/').slice(0, 2).join('/')
                : spec.split('/')[0];
              // Skip relative imports and node builtins
              if (!pkgName.startsWith('.') && !pkgName.startsWith('node:') && !builtinModules.has(pkgName)) {
                usedPackages.add(pkgName);
              }
            }
          }
        } catch { /* skip binary files */ }
      }
    }
  }

  for (const dir of srcDirs) {
    const fullDir = path.join(cwd, dir);
    if (fs.existsSync(fullDir)) walk(fullDir);
  }

  // 3. Compare declared vs used
  const unused = [...allDeclared].filter(pkg => !usedPackages.has(pkg));
  const undeclared = [...usedPackages].filter(pkg => !allDeclared.has(pkg));

  return {
    declared: { deps, devDeps },
    used: [...usedPackages],
    unused,
    undeclared,
  };
}

export function formatDepAnalysis(analysis: DepAnalysis): string {
  const lines: string[] = ['📦 **依赖分析**\n'];

  lines.push(`已声明: ${analysis.declared.deps.length} 个依赖 + ${analysis.declared.devDeps.length} 个开发依赖`);
  lines.push(`实际使用: ${analysis.used.length} 个包\n`);

  if (analysis.unused.length > 0) {
    lines.push(`⚠️ **未使用的依赖** (${analysis.unused.length} 个):`);
    for (const pkg of analysis.unused) {
      const isDev = analysis.declared.devDeps.includes(pkg);
      lines.push(`  - ${pkg}${isDev ? ' (devDep)' : ''}`);
    }
    lines.push(`\n可以用 \`npm uninstall ${analysis.unused.filter(p => !analysis.declared.devDeps.includes(p)).join(' ')}\` 移除`);
    lines.push('');
  }

  if (analysis.undeclared.length > 0) {
    lines.push(`❌ **未声明的依赖** (${analysis.undeclared.length} 个):`);
    for (const pkg of analysis.undeclared) {
      lines.push(`  - ${pkg}`);
    }
    lines.push(`\n可以用 \`npm install ${analysis.undeclared.join(' ')}\` 添加`);
    lines.push('');
  }

  if (analysis.unused.length === 0 && analysis.undeclared.length === 0) {
    lines.push('✅ 依赖状态良好，没有发现未使用或未声明的依赖。');
  }

  return lines.join('\n');
}
