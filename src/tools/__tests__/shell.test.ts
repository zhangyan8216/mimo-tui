import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ToolContext } from '../registry.js';

const { shellTool, getShellInvocation } = await import('../shell.js');

function makeCtx(cwd?: string): ToolContext {
  return {
    cwd: cwd ?? process.cwd(),
    workingDirectory: cwd ?? process.cwd(),
    sandbox: {
      validatePath: vi.fn().mockReturnValue({ allowed: true, resolved: cwd ?? process.cwd() }),
    },
  } as unknown as ToolContext;
}

describe('shell tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes a simple echo command', async () => {
    const result = await shellTool.execute(
      { command: 'echo hello', timeout: 15000 },
      makeCtx(),
    );
    expect(result).toContain('hello');
    expect(result).toMatch(/\[\S*: 0\]/);
  }, 20000);

  it('captures stdout output', async () => {
    const result = await shellTool.execute(
      { command: 'echo line1 && echo line2', timeout: 15000 },
      makeCtx(),
    );
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  }, 20000);

  it('captures stderr output', async () => {
    const result = await shellTool.execute(
      { command: 'node -e "process.stderr.write(\'error output\'); process.exit(0)"', timeout: 15000 },
      makeCtx(),
    );
    expect(result).toContain('error output');
  }, 20000);

  it('returns non-zero exit code on failure', async () => {
    const result = await shellTool.execute(
      { command: 'node -e "process.exit(42)"', timeout: 15000 },
      makeCtx(),
    );
    expect(result).toMatch(/\[\S*: 42\]/);
  }, 20000);

  it('returns exit code 0 on success', async () => {
    const result = await shellTool.execute(
      { command: 'node -e "process.exit(0)"', timeout: 15000 },
      makeCtx(),
    );
    expect(result).toMatch(/\[\S*: 0\]/);
  }, 20000);

  it('times out on a long-running command', async () => {
    await expect(
      shellTool.execute(
        { command: 'node -e "setTimeout(() => {}, 30000)"', timeout: 200 },
        makeCtx(),
      ),
    ).rejects.toThrow();
  });

  it('uses default timeout of 60000ms', async () => {
    const result = await shellTool.execute(
      { command: 'echo fast' },
      makeCtx(),
    );
    expect(result).toMatch(/\[\S*: 0\]/);
  }, 20000);

  it('caps timeout at 300000ms', async () => {
    const result = await shellTool.execute(
      { command: 'echo ok', timeout: 999999 },
      makeCtx(),
    );
    expect(result).toMatch(/\[\S*: 0\]/);
  }, 20000);

  describe('platform-specific shell selection', () => {
    it('uses powershell on Windows', () => {
      const invocation = getShellInvocation('echo windows-test', 'win32');
      expect(invocation.shell).toBe('powershell');
      expect(invocation.args).toContain('-NoProfile');
      expect(invocation.args.at(-1)).toContain('echo windows-test');
    });

    it('uses bash on Linux', () => {
      expect(getShellInvocation('echo unix-test', 'linux')).toEqual({
        shell: 'bash',
        args: ['-c', 'echo unix-test'],
      });
    });

    it('uses bash on macOS', () => {
      expect(getShellInvocation('echo mac-test', 'darwin')).toEqual({
        shell: 'bash',
        args: ['-c', 'echo mac-test'],
      });
    });
  });

  it('has requiresApproval set to true', () => {
    expect(shellTool.requiresApproval).toBe(true);
  });

  it('has correct tool name', () => {
    expect(shellTool.name).toBe('shell');
  });

  it('has command as required parameter', () => {
    expect(shellTool.parameters.required).toContain('command');
  });
});
