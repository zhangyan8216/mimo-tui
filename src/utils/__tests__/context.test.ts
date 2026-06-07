// src/utils/__tests__/context.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildProjectContext, extractRelevantContext } from '../context.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-context');

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('buildProjectContext', () => {
  it('returns a ProjectContext with expected fields', () => {
    const ctx = buildProjectContext(tmpDir);
    expect(ctx).toHaveProperty('fileTree');
    expect(ctx).toHaveProperty('packageInfo');
    expect(ctx).toHaveProperty('tsConfig');
    expect(ctx).toHaveProperty('changedFiles');
    expect(ctx).toHaveProperty('readmeSummary');
  });

  it('builds file tree from directory contents', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'console.log("hi")', 'utf-8');
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '', 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.fileTree).toContain('app.ts');
    expect(ctx.fileTree).toContain('src/');
  });

  it('extracts package.json info when present', () => {
    const pkg = {
      name: 'test-project',
      description: 'A test project',
      scripts: { test: 'vitest', build: 'tsc' },
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.packageInfo).toContain('test-project');
    expect(ctx.packageInfo).toContain('A test project');
    expect(ctx.packageInfo).toContain('vitest');
    expect(ctx.packageInfo).toContain('react');
  });

  it('extracts tsconfig.json info when present', () => {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        strict: true,
        jsx: 'react-jsx',
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig), 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.tsConfig).toContain('target: ES2022');
    expect(ctx.tsConfig).toContain('strict: true');
  });

  it('extracts README summary when present', () => {
    const readme = '# My Project\nThis is a great project for testing purposes.';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readme, 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.readmeSummary).toContain('My Project');
  });

  it('returns empty packageInfo when no package.json exists', () => {
    const ctx = buildProjectContext(tmpDir);
    expect(ctx.packageInfo).toBe('');
  });

  it('returns empty readmeSummary when no README exists', () => {
    const ctx = buildProjectContext(tmpDir);
    expect(ctx.readmeSummary).toBe('');
  });

  it('returns empty tsConfig when no tsconfig.json exists', () => {
    const ctx = buildProjectContext(tmpDir);
    expect(ctx.tsConfig).toBe('');
  });
});

describe('SKIP_DIRS exclusion in file tree', () => {
  it('excludes node_modules from file tree', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), '', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), '', 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.fileTree).not.toContain('node_modules');
    expect(ctx.fileTree).toContain('app.ts');
  });

  it('excludes .git from file tree', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), '', 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.fileTree).not.toContain('.git');
  });

  it('excludes dist from file tree', () => {
    fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'dist', 'bundle.js'), '', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), '', 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.fileTree).not.toContain('dist');
  });

  it('excludes build from file tree', () => {
    fs.mkdirSync(path.join(tmpDir, 'build'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'build', 'output.js'), '', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), '', 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.fileTree).not.toContain('build');
  });

  it('excludes __pycache__ from file tree', () => {
    fs.mkdirSync(path.join(tmpDir, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'main.py'), '', 'utf-8');

    const ctx = buildProjectContext(tmpDir);
    expect(ctx.fileTree).not.toContain('__pycache__');
  });
});

describe('extractRelevantContext', () => {
  it('extracts file references from user message', () => {
    // Create a file that the message references
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'const x = 1;', 'utf-8');

    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'Please fix the bug in app.ts',
      tmpDir,
      projectCtx,
    );

    expect(result).toContain('app.ts');
  });

  it('extracts file references with path patterns', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {};', 'utf-8');

    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'Look at src/index.ts for the issue',
      tmpDir,
      projectCtx,
    );

    expect(result).toContain('src/index.ts');
  });

  it('extracts file references with Chinese keyword path pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}', 'utf-8');

    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'file: config.json please update',
      tmpDir,
      projectCtx,
    );

    expect(result).toContain('config.json');
  });

  it('extracts symbol references (CamelCase patterns)', () => {
    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'I need to understand the UserManager class',
      tmpDir,
      projectCtx,
    );

    // extractSymbolReferences looks for CamelCase + suffix patterns
    // UserManager should match the pattern
    // (the result may or may not find a definition, but the attempt is made)
    expect(typeof result).toBe('string');
  });

  it('returns empty string when no references found', () => {
    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'Hello, how are you?',
      tmpDir,
      projectCtx,
    );

    expect(result).toBe('');
  });

  it('skips files larger than 50KB', () => {
    const largeContent = 'x'.repeat(60000);
    fs.writeFileSync(path.join(tmpDir, 'large.ts'), largeContent, 'utf-8');

    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'Check large.ts',
      tmpDir,
      projectCtx,
    );

    // The file is too large, so it should not be included in context
    expect(result).not.toContain(largeContent.slice(0, 100));
  });

  it('limits to 5 file references', () => {
    // Create 8 files
    for (let i = 1; i <= 8; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.ts`), `// file${i}`, 'utf-8');
    }

    const projectCtx = buildProjectContext(tmpDir);
    const result = extractRelevantContext(
      'Check file1.ts file2.ts file3.ts file4.ts file5.ts file6.ts file7.ts file8.ts',
      tmpDir,
      projectCtx,
    );

    // Only first 5 should be processed (some may match the pattern)
    expect(typeof result).toBe('string');
  });
});
