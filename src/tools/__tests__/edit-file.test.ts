// src/tools/__tests__/edit-file.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { editFileTool } from '../edit-file.js';
import type { ToolContext } from '../registry.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-edit-file');

function makeCtx(): ToolContext {
  return {
    cwd: tmpDir,
    workingDirectory: tmpDir,
    sandbox: {
      validatePath: vi.fn().mockImplementation((p: string) => ({
        allowed: true,
        resolved: path.resolve(p),
      })),
    },
  } as unknown as ToolContext;
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('edit_file tool', () => {
  it('successfully replaces a unique string', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    fs.writeFileSync(filePath, 'hello world\nfoo bar', 'utf-8');

    const result = await editFileTool.execute({
      path: filePath,
      old_string: 'hello world',
      new_string: 'goodbye world',
    }, makeCtx());

    expect(result).toContain('replaced 1 line(s) with 1 line(s)');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('goodbye world\nfoo bar');
  });

  it('throws string not found error when old_string does not exist', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    fs.writeFileSync(filePath, 'hello world', 'utf-8');

    await expect(
      editFileTool.execute({
        path: filePath,
        old_string: 'nonexistent text',
        new_string: 'replacement',
      }, makeCtx())
    ).rejects.toThrow('String not found in file');
  });

  it('throws multiple occurrences error when old_string appears more than once', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    fs.writeFileSync(filePath, 'foo bar foo baz foo', 'utf-8');

    await expect(
      editFileTool.execute({
        path: filePath,
        old_string: 'foo',
        new_string: 'qux',
      }, makeCtx())
    ).rejects.toThrow('Found 3 occurrences of the string');
  });

  it('throws file not found error for missing file', async () => {
    await expect(
      editFileTool.execute({
        path: path.join(tmpDir, 'nonexistent.txt'),
        old_string: 'a',
        new_string: 'b',
      }, makeCtx())
    ).rejects.toThrow('File not found');
  });

  it('throws access denied when sandbox rejects path', async () => {
    const ctx = makeCtx();
    (ctx.sandbox.validatePath as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: false,
      resolved: '/etc/passwd',
      reason: 'Path is in blocked directory',
    });

    await expect(
      editFileTool.execute({
        path: '/etc/passwd',
        old_string: 'a',
        new_string: 'b',
      }, ctx)
    ).rejects.toThrow('Access denied');
  });

  it('handles multiline old_string and new_string', async () => {
    const filePath = path.join(tmpDir, 'multi.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3', 'utf-8');

    const result = await editFileTool.execute({
      path: filePath,
      old_string: 'line1\nline2',
      new_string: 'new1\nnew2\nnew3',
    }, makeCtx());

    expect(result).toContain('replaced 2 line(s) with 3 line(s)');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new1\nnew2\nnew3\nline3');
  });

  it('can delete text by replacing with empty string', async () => {
    const filePath = path.join(tmpDir, 'delete.txt');
    fs.writeFileSync(filePath, 'keep this\nremove this\nkeep this too', 'utf-8');

    const result = await editFileTool.execute({
      path: filePath,
      old_string: 'remove this\n',
      new_string: '',
    }, makeCtx());

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('keep this\nkeep this too');
  });
});
