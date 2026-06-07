// src/tools/__tests__/read-file.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readFileTool } from '../read-file.js';
import type { ToolContext } from '../registry.js';

// Create a temp directory for test fixtures
const tmpDir = path.join(os.tmpdir(), 'mimo-test-read-file');

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    cwd: tmpDir,
    workingDirectory: tmpDir,
    sandbox: {
      validatePath: vi.fn().mockImplementation((p: string) => ({
        allowed: true,
        resolved: path.resolve(p),
      })),
    },
    ...overrides,
  } as ToolContext;
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('read_file tool', () => {
  it('reads an existing file and returns content with line numbers', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3', 'utf-8');

    const result = await readFileTool.execute({ path: filePath }, makeCtx());
    expect(result).toContain('[Lines 1-3 of 3]');
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
    expect(result).toContain('3\tline3');
  });

  it('respects offset and limit parameters', async () => {
    const filePath = path.join(tmpDir, 'multiline.txt');
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    fs.writeFileSync(filePath, lines, 'utf-8');

    const result = await readFileTool.execute({ path: filePath, offset: 2, limit: 3 }, makeCtx());
    expect(result).toContain('[Lines 3-5 of 10]');
    expect(result).toContain('3\tline3');
    expect(result).toContain('4\tline4');
    expect(result).toContain('5\tline5');
    expect(result).not.toContain('line1');
    expect(result).toContain('(5 more lines');
  });

  it('throws file not found error for missing file', async () => {
    await expect(
      readFileTool.execute({ path: path.join(tmpDir, 'nonexistent.txt') }, makeCtx())
    ).rejects.toThrow('File not found');
  });

  it('throws access denied when sandbox rejects path', async () => {
    const ctx = makeCtx({
      sandbox: {
        validatePath: vi.fn().mockReturnValue({
          allowed: false,
          resolved: '/etc/passwd',
          reason: 'Path is in blocked directory',
        }),
      },
    } as unknown as ToolContext);

    await expect(
      readFileTool.execute({ path: '/etc/passwd' }, ctx)
    ).rejects.toThrow('Access denied');
  });

  it('throws error for file larger than 2MB', async () => {
    const filePath = path.join(tmpDir, 'large.txt');
    // Create a file just over 2MB
    const content = 'x'.repeat(2 * 1024 * 1024 + 1);
    fs.writeFileSync(filePath, content, 'utf-8');

    await expect(
      readFileTool.execute({ path: filePath }, makeCtx())
    ).rejects.toThrow('File too large');
  });

  it('handles offset clamped to last line', async () => {
    const filePath = path.join(tmpDir, 'short.txt');
    fs.writeFileSync(filePath, 'line1\nline2', 'utf-8');

    // offset=10 gets clamped to min(10, lines.length-1) = 1, limit = min(2000, 2-1) = 1
    const result = await readFileTool.execute({ path: filePath, offset: 10 }, makeCtx());
    expect(result).toContain('[Lines 2-2 of 2]');
    expect(result).toContain('2\tline2');
  });

  it('shows suffix when not all lines are read', async () => {
    const filePath = path.join(tmpDir, 'partial.txt');
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');
    fs.writeFileSync(filePath, lines, 'utf-8');

    const result = await readFileTool.execute({ path: filePath, limit: 10 }, makeCtx());
    expect(result).toContain('(90 more lines');
  });
});
