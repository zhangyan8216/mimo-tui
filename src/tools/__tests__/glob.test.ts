// src/tools/__tests__/glob.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { globTool } from '../glob.js';
import type { ToolContext } from '../registry.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-glob');

function makeCtx(): ToolContext {
  return {
    cwd: tmpDir,
    workingDirectory: tmpDir,
    sandbox: {
      validatePath: vi.fn().mockImplementation((p: string) => ({
        allowed: true,
        resolved: path.resolve(tmpDir, p),
      })),
    },
  } as unknown as ToolContext;
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  // Create test file structure
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {}', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'src', 'app.tsx'), 'export {}', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), 'module.exports = {}', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test', 'utf-8');

  // Create directories that should be excluded
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'some-pkg', 'index.js'), '', 'utf-8');
  fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'dist', 'bundle.js'), '', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('glob tool', () => {
  it('matches files with a pattern', async () => {
    const result = await globTool.execute(
      { pattern: '**/*.ts' },
      makeCtx(),
    );
    expect(result).toContain('找到');
    expect(result).toContain('index.ts');
  });

  it('matches multiple file types', async () => {
    const result = await globTool.execute(
      { pattern: '**/*.{ts,tsx}' },
      makeCtx(),
    );
    expect(result).toContain('index.ts');
    expect(result).toContain('app.tsx');
  });

  it('returns no matches message when no files match', async () => {
    const result = await globTool.execute(
      { pattern: '**/*.xyz' },
      makeCtx(),
    );
    expect(result).toBe('未找到匹配模式的文件: **/*.xyz');
  });

  it('uses custom path parameter', async () => {
    const result = await globTool.execute(
      { pattern: '*.ts', path: path.join(tmpDir, 'src') },
      makeCtx(),
    );
    expect(result).toContain('index.ts');
  });

  it('excludes node_modules by default', async () => {
    const result = await globTool.execute(
      { pattern: '**/*.js' },
      makeCtx(),
    );
    // Should find utils.js but not node_modules files
    expect(result).toContain('utils.js');
    expect(result).not.toContain('node_modules');
  });

  it('excludes dist by default', async () => {
    const result = await globTool.execute(
      { pattern: '**/*.js' },
      makeCtx(),
    );
    expect(result).not.toContain('dist');
    expect(result).not.toContain('bundle.js');
  });

  it('shows correct file count in header', async () => {
    const result = await globTool.execute(
      { pattern: '**/*.json' },
      makeCtx(),
    );
    expect(result).toContain('找到 1 个文件:');
  });

  it('respects limit parameter', async () => {
    const result = await globTool.execute(
      { pattern: '**/*', limit: 2 },
      makeCtx(),
    );
    // Should show limited results
    expect(result).toContain('显示前 2 个');
  });

  it('has correct tool name', () => {
    expect(globTool.name).toBe('glob');
  });

  it('does not require approval', () => {
    expect(globTool.requiresApproval).toBe(false);
  });

  it('has pattern as required parameter', () => {
    expect(globTool.parameters.required).toContain('pattern');
  });
});
