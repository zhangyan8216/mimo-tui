// src/tools/__tests__/code-review.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { codeReviewTool } from '../code-review.js';
import type { ToolContext } from '../registry.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-code-review');

function makeCtx(): ToolContext {
  return {
    cwd: tmpDir,
    workingDirectory: tmpDir,
    sandbox: {
      validatePath: () => ({ allowed: true, resolved: tmpDir }),
    },
  } as unknown as ToolContext;
}

const ctx = makeCtx();
const trackedFile = 'app.ts';

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
  execSync('git config core.autocrlf false', { cwd: tmpDir, stdio: 'ignore' });
  // Create an initial tracked file so git diff works on modifications
  fs.writeFileSync(path.join(tmpDir, trackedFile), '// initial\n', 'utf-8');
  execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'ignore' });
});

beforeEach(() => {
  // Reset the tracked file and staging area before each test
  try { execSync('git reset HEAD', { cwd: tmpDir, stdio: 'ignore' }); } catch {}
  fs.writeFileSync(path.join(tmpDir, trackedFile), '// initial\n', 'utf-8');
  try { execSync('git checkout -- .', { cwd: tmpDir, stdio: 'ignore' }); } catch {}
  try { execSync('git clean -fd', { cwd: tmpDir, stdio: 'ignore' }); } catch {}
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('code_review tool', () => {
  it('has correct tool name', () => {
    expect(codeReviewTool.name).toBe('code_review');
  });

  it('has requiresApproval set to false', () => {
    expect(codeReviewTool.requiresApproval).toBe(false);
  });

  it('has action as required parameter', () => {
    expect(codeReviewTool.parameters.required).toContain('action');
  });

  describe('diff action', () => {
    it('detects console.log in added lines', async () => {
      // Modify tracked file to add console.log
      fs.writeFileSync(path.join(tmpDir, trackedFile), '// initial\nconsole.log("debug")\n', 'utf-8');

      const result = await codeReviewTool.execute({ action: 'diff' }, ctx);
      expect(result).toContain('console.log');
      expect(result).toContain('代码审查');
    });

    it('detects TODO/FIXME comments', async () => {
      fs.writeFileSync(
        path.join(tmpDir, trackedFile),
        '// initial\n// TODO: fix this later\n// FIXME: broken\n',
        'utf-8',
      );

      const result = await codeReviewTool.execute({ action: 'diff' }, ctx);
      expect(result).toContain('TODO/FIXME');
    });

    it('detects eval() as security risk', async () => {
      fs.writeFileSync(
        path.join(tmpDir, trackedFile),
        '// initial\nconst result = eval(userInput)\n',
        'utf-8',
      );

      const result = await codeReviewTool.execute({ action: 'diff', focus: 'security' }, ctx);
      expect(result).toContain('eval()');
      expect(result).toContain('安全风险');
    });

    it('detects innerHTML as XSS risk', async () => {
      fs.writeFileSync(
        path.join(tmpDir, trackedFile),
        '// initial\ndiv.innerHTML = userInput\n',
        'utf-8',
      );

      const result = await codeReviewTool.execute({ action: 'diff', focus: 'security' }, ctx);
      expect(result).toContain('innerHTML');
      expect(result).toContain('XSS');
    });

    it('reports no issues for clean code', async () => {
      fs.writeFileSync(
        path.join(tmpDir, trackedFile),
        '// initial\nexport function add(a: number, b: number) { return a + b; }\n',
        'utf-8',
      );

      const result = await codeReviewTool.execute({ action: 'diff' }, ctx);
      expect(result).toContain('未发现明显问题');
    });

    it('reports no changes when working tree is clean', async () => {
      // File was reset in beforeEach, so working tree should be clean
      const result = await codeReviewTool.execute({ action: 'diff' }, ctx);
      expect(result).toContain('没有需要审查的变更');
    });
  });

  describe('staged action', () => {
    it('reviews staged changes', async () => {
      fs.writeFileSync(
        path.join(tmpDir, trackedFile),
        '// initial\nconst x = eval("1+1")\n',
        'utf-8',
      );
      execSync(`git add ${trackedFile}`, { cwd: tmpDir, stdio: 'ignore' });

      const result = await codeReviewTool.execute({ action: 'staged' }, ctx);
      expect(result).toContain('eval()');
      expect(result).toContain('安全风险');
    });

    it('reports no staged changes when index is clean', async () => {
      // Index should be clean after beforeEach reset
      const result = await codeReviewTool.execute({ action: 'staged' }, ctx);
      expect(result).toContain('没有需要审查的变更');
    });
  });

  describe('file action', () => {
    it('returns error when target is missing', async () => {
      const result = await codeReviewTool.execute({ action: 'file' }, ctx);
      expect(result).toContain('错误');
      expect(result).toContain('target');
    });

    it('returns error for nonexistent file', async () => {
      const result = await codeReviewTool.execute({ action: 'file', target: 'nope.ts' }, ctx);
      expect(result).toContain('错误');
      expect(result).toContain('不存在');
    });

    it('reviews an existing file', async () => {
      fs.writeFileSync(path.join(tmpDir, 'review-me.ts'), 'console.log("test")\n', 'utf-8');

      const result = await codeReviewTool.execute({ action: 'file', target: 'review-me.ts' }, ctx);
      expect(result).toContain('console.log');
      expect(result).toContain('代码审查');
    });
  });

  describe('focus parameter', () => {
    it('focuses on bugs only', async () => {
      fs.writeFileSync(
        path.join(tmpDir, trackedFile),
        '// initial\nconsole.log("bug")\n',
        'utf-8',
      );

      const result = await codeReviewTool.execute({ action: 'diff', focus: 'bugs' }, ctx);
      expect(result).toContain('console.log');
    });
  });
});
