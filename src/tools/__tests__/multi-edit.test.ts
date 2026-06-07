// src/tools/__tests__/multi-edit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { multiEditTool } from '../multi-edit.js';
import type { ToolContext } from '../registry.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-multi-edit');

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

describe('multi_edit tool', () => {
  it('has correct tool name', () => {
    expect(multiEditTool.name).toBe('multi_edit');
  });

  it('has requiresApproval set to true', () => {
    expect(multiEditTool.requiresApproval).toBe(true);
  });

  it('has edits as required parameter', () => {
    expect(multiEditTool.parameters.required).toContain('edits');
  });

  describe('successful edits', () => {
    it('applies a single edit', async () => {
      const filePath = path.join(tmpDir, 'single.txt');
      fs.writeFileSync(filePath, 'hello world', 'utf-8');

      const result = await multiEditTool.execute(
        {
          edits: [{ file: filePath, old_text: 'hello', new_text: 'goodbye' }],
        },
        makeCtx(),
      );

      expect(result).toContain('已应用 1 处编辑');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('goodbye world');
    });

    it('applies edits to multiple files', async () => {
      const fileA = path.join(tmpDir, 'a.txt');
      const fileB = path.join(tmpDir, 'b.txt');
      fs.writeFileSync(fileA, 'foo bar', 'utf-8');
      fs.writeFileSync(fileB, 'baz qux', 'utf-8');

      const result = await multiEditTool.execute(
        {
          edits: [
            { file: fileA, old_text: 'foo', new_text: 'FOO' },
            { file: fileB, old_text: 'qux', new_text: 'QUX' },
          ],
        },
        makeCtx(),
      );

      expect(result).toContain('已应用 2 处编辑');
      expect(fs.readFileSync(fileA, 'utf-8')).toBe('FOO bar');
      expect(fs.readFileSync(fileB, 'utf-8')).toBe('baz QUX');
    });

    it('replaces multiline text', async () => {
      const filePath = path.join(tmpDir, 'multi.txt');
      fs.writeFileSync(filePath, 'line1\nline2\nline3', 'utf-8');

      const result = await multiEditTool.execute(
        {
          edits: [{ file: filePath, old_text: 'line1\nline2', new_text: 'new1\nnew2\nnew3' }],
        },
        makeCtx(),
      );

      expect(result).toContain('已应用 1 处编辑');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new1\nnew2\nnew3\nline3');
    });
  });

  describe('validation failures', () => {
    it('throws for empty edits array', async () => {
      await expect(
        multiEditTool.execute({ edits: [] }, makeCtx()),
      ).rejects.toThrow('non-empty array');
    });

    it('throws for non-array edits', async () => {
      await expect(
        multiEditTool.execute({ edits: 'not-an-array' } as any, makeCtx()),
      ).rejects.toThrow('non-empty array');
    });

    it('throws when file is not found', async () => {
      await expect(
        multiEditTool.execute(
          {
            edits: [{ file: path.join(tmpDir, 'nonexistent.txt'), old_text: 'a', new_text: 'b' }],
          },
          makeCtx(),
        ),
      ).rejects.toThrow('file not found');
    });

    it('throws when old_text is not unique', async () => {
      const filePath = path.join(tmpDir, 'dup.txt');
      fs.writeFileSync(filePath, 'foo bar foo baz foo', 'utf-8');

      await expect(
        multiEditTool.execute(
          {
            edits: [{ file: filePath, old_text: 'foo', new_text: 'qux' }],
          },
          makeCtx(),
        ),
      ).rejects.toThrow('3 occurrences');
    });

    it('throws when old_text is not found in file', async () => {
      const filePath = path.join(tmpDir, 'nope.txt');
      fs.writeFileSync(filePath, 'hello world', 'utf-8');

      await expect(
        multiEditTool.execute(
          {
            edits: [{ file: filePath, old_text: 'nonexistent', new_text: 'replacement' }],
          },
          makeCtx(),
        ),
      ).rejects.toThrow('old_text not found');
    });

    it('throws for missing edit fields', async () => {
      await expect(
        multiEditTool.execute(
          {
            edits: [{ file: path.join(tmpDir, 'x.txt'), old_text: '', new_text: 'b' }],
          },
          makeCtx(),
        ),
      ).rejects.toThrow('missing required fields');
    });
  });

  describe('atomicity', () => {
    it('does not apply any edits if one validation fails', async () => {
      const fileA = path.join(tmpDir, 'valid.txt');
      const fileB = path.join(tmpDir, 'invalid.txt');
      fs.writeFileSync(fileA, 'aaa', 'utf-8');
      // fileB does not exist

      await expect(
        multiEditTool.execute(
          {
            edits: [
              { file: fileA, old_text: 'aaa', new_text: 'AAA' },
              { file: fileB, old_text: 'bbb', new_text: 'BBB' },
            ],
          },
          makeCtx(),
        ),
      ).rejects.toThrow('file not found');

      // fileA should not have been modified (atomicity)
      expect(fs.readFileSync(fileA, 'utf-8')).toBe('aaa');
    });

    it('does not apply any edits if uniqueness check fails', async () => {
      const fileA = path.join(tmpDir, 'a.txt');
      const fileB = path.join(tmpDir, 'b.txt');
      fs.writeFileSync(fileA, 'unique text here', 'utf-8');
      fs.writeFileSync(fileB, 'dup dup dup', 'utf-8');

      await expect(
        multiEditTool.execute(
          {
            edits: [
              { file: fileA, old_text: 'unique', new_text: 'UNIQUE' },
              { file: fileB, old_text: 'dup', new_text: 'DUP' },
            ],
          },
          makeCtx(),
        ),
      ).rejects.toThrow('occurrences');

      // fileA should not have been modified
      expect(fs.readFileSync(fileA, 'utf-8')).toBe('unique text here');
    });

    it('applies all edits when all validations pass', async () => {
      const fileA = path.join(tmpDir, 'a.txt');
      const fileB = path.join(tmpDir, 'b.txt');
      const fileC = path.join(tmpDir, 'c.txt');
      fs.writeFileSync(fileA, 'alpha', 'utf-8');
      fs.writeFileSync(fileB, 'beta', 'utf-8');
      fs.writeFileSync(fileC, 'gamma', 'utf-8');

      const result = await multiEditTool.execute(
        {
          edits: [
            { file: fileA, old_text: 'alpha', new_text: 'ALPHA' },
            { file: fileB, old_text: 'beta', new_text: 'BETA' },
            { file: fileC, old_text: 'gamma', new_text: 'GAMMA' },
          ],
        },
        makeCtx(),
      );

      expect(result).toContain('已应用 3 处编辑');
      expect(fs.readFileSync(fileA, 'utf-8')).toBe('ALPHA');
      expect(fs.readFileSync(fileB, 'utf-8')).toBe('BETA');
      expect(fs.readFileSync(fileC, 'utf-8')).toBe('GAMMA');
    });
  });
});
