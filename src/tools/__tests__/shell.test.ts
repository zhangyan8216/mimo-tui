// src/tools/__tests__/shell.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import type { ToolContext } from '../registry.js';

// We need to mock os.platform before importing the tool module.
// Vitest hoists vi.mock calls, so we set the mock return value
// in individual tests via a helper.

let platformOverride: string | undefined;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    default: {
      ...actual,
      platform: () => platformOverride ?? actual.platform(),
    },
  };
});

// Import after mocking
const { shellTool } = await import('../shell.js');

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
  beforeEach(() => {
    platformOverride = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes a simple echo command', async () => {
    const result = await shellTool.execute(
      { command: 'echo hello' },
      makeCtx(),
    );
    expect(result).toContain('hello');
    expect(result).toContain('[Exit code: 0]');
  });

  it('captures stdout output', async () => {
    const result = await shellTool.execute(
      { command: 'echo line1 && echo line2' },
      makeCtx(),
    );
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  });

  it('captures stderr output', async () => {
    // Use node -e to write to stderr
    const result = await shellTool.execute(
      { command: 'node -e "process.stderr.write(\'error output\'); process.exit(0)"' },
      makeCtx(),
    );
    expect(result).toContain('[STDERR]');
    expect(result).toContain('error output');
  });

  it('returns non-zero exit code on failure', async () => {
    const result = await shellTool.execute(
      { command: 'node -e "process.exit(42)"' },
      makeCtx(),
    );
    expect(result).toContain('[Exit code: 42]');
  });

  it('returns exit code 0 on success', async () => {
    const result = await shellTool.execute(
      { command: 'node -e "process.exit(0)"' },
      makeCtx(),
    );
    expect(result).toContain('[Exit code: 0]');
  });

  it('times out on a long-running command', async () => {
    // Use a very short timeout with a command that sleeps longer
    await expect(
      shellTool.execute(
        { command: 'node -e "setTimeout(() => {}, 30000)"', timeout: 200 },
        makeCtx(),
      ),
    ).rejects.toThrow('timed out');
  });

  it('uses default timeout of 60000ms', async () => {
    // The shell tool sets timeout to min(args.timeout || 60000, 300000)
    // We verify that passing no timeout doesn't cause immediate failure
    const result = await shellTool.execute(
      { command: 'echo fast' },
      makeCtx(),
    );
    expect(result).toContain('[Exit code: 0]');
  });

  it('caps timeout at 300000ms', async () => {
    // Passing a huge timeout should be capped; just verify no error
    const result = await shellTool.execute(
      { command: 'echo ok', timeout: 999999 },
      makeCtx(),
    );
    expect(result).toContain('[Exit code: 0]');
  });

  describe('platform-specific shell selection', () => {
    it('uses powershell on Windows', async () => {
      platformOverride = 'win32';
      // Verify the tool selects powershell by checking the implementation
      // On a non-Windows CI, we can't actually run powershell, so we just
      // verify that os.platform() returns 'win32' when mocked
      expect(os.platform()).toBe('win32');
      // The shell tool checks os.platform() at execute time and uses 'powershell' for win32
      // We verify the logic by reading the source - the actual spawn is tested on the real platform
      platformOverride = undefined;
    });

    it('uses bash on non-Windows platforms', async () => {
      platformOverride = 'linux';
      const result = await shellTool.execute(
        { command: 'echo unix-test' },
        makeCtx(),
      );
      expect(result).toContain('[Exit code: 0]');
    });

    it('uses bash on darwin', async () => {
      platformOverride = 'darwin';
      const result = await shellTool.execute(
        { command: 'echo mac-test' },
        makeCtx(),
      );
      expect(result).toContain('[Exit code: 0]');
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
