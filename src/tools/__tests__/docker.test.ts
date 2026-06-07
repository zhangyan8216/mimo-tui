// src/tools/__tests__/docker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import os from 'os';
import type { ToolContext } from '../registry.js';

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

// Create a mock spawn function
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

// Import after mocking
const { dockerTool } = await import('../docker.js');

function makeCtx(cwd?: string): ToolContext {
  return {
    cwd: cwd ?? process.cwd(),
    workingDirectory: cwd ?? process.cwd(),
    sandbox: {
      validatePath: vi.fn().mockReturnValue({ allowed: true, resolved: cwd ?? process.cwd() }),
    },
  } as unknown as ToolContext;
}

function createMockProc() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('docker tool', () => {
  beforeEach(() => {
    platformOverride = undefined;
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has requiresApproval set to true', () => {
    expect(dockerTool.requiresApproval).toBe(true);
  });

  it('has correct tool name', () => {
    expect(dockerTool.name).toBe('docker');
  });

  it('has action as required parameter', () => {
    expect(dockerTool.parameters.required).toContain('action');
  });

  it('returns error for missing target on run action', async () => {
    const result = await dockerTool.execute({ action: 'run' }, makeCtx());
    expect(result).toContain('[Error]');
    expect(result).toContain('target');
  });

  it('returns error for missing target on logs action', async () => {
    const result = await dockerTool.execute({ action: 'logs' }, makeCtx());
    expect(result).toContain('[Error]');
    expect(result).toContain('target');
  });

  it('returns error for missing target on stop action', async () => {
    const result = await dockerTool.execute({ action: 'stop' }, makeCtx());
    expect(result).toContain('[Error]');
    expect(result).toContain('target');
  });

  it('returns error for missing target on rm action', async () => {
    const result = await dockerTool.execute({ action: 'rm' }, makeCtx());
    expect(result).toContain('[Error]');
    expect(result).toContain('target');
  });

  it('returns error for missing target on exec action', async () => {
    const result = await dockerTool.execute({ action: 'exec' }, makeCtx());
    expect(result).toContain('[Error]');
    expect(result).toContain('target');
  });

  it('returns error for missing command on exec action', async () => {
    const result = await dockerTool.execute(
      { action: 'exec', target: 'mycontainer' },
      makeCtx(),
    );
    expect(result).toContain('[Error]');
    expect(result).toContain('command');
  });

  it('returns error for unknown action', async () => {
    const result = await dockerTool.execute({ action: 'unknown' }, makeCtx());
    expect(result).toContain('[Error]');
    expect(result).toContain('未知');
  });

  it('builds ps command and returns output', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute({ action: 'ps' }, makeCtx());
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('CONTAINER ID  IMAGE\n'));
      proc.emit('close', 0);
    });

    const result = await promise;
    expect(result).toContain('CONTAINER ID');
    expect(result).toContain('[退出码: 0]');
  });

  it('builds ps command with extra args', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute({ action: 'ps', args: '--format table' }, makeCtx());
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('CONTAINER ID\n'));
      proc.emit('close', 0);
    });

    const result = await promise;
    expect(result).toContain('[退出码: 0]');

    // Verify the spawn call included the extra args
    const callArgs = mockSpawn.mock.calls[0];
    const cmdString = callArgs[1].join(' ');
    expect(cmdString).toContain('--format table');
  });

  it('builds images command', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute({ action: 'images' }, makeCtx());
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('REPOSITORY  TAG\n'));
      proc.emit('close', 0);
    });

    const result = await promise;
    expect(result).toContain('REPOSITORY');
    expect(result).toContain('[退出码: 0]');
  });

  it('passes stderr output through', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute({ action: 'ps' }, makeCtx());
    process.nextTick(() => {
      proc.stderr.emit('data', Buffer.from('Cannot connect to Docker daemon'));
      proc.emit('close', 1);
    });

    const result = await promise;
    expect(result).toContain('[错误输出]');
    expect(result).toContain('Cannot connect to Docker daemon');
    expect(result).toContain('[退出码: 1]');
  });

  it('handles spawn error (docker not installed)', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute({ action: 'ps' }, makeCtx());
    process.nextTick(() => {
      proc.emit('error', new Error('ENOENT: docker not found'));
    });

    const result = await promise;
    expect(result).toContain('[Error]');
    expect(result).toContain('docker not found');
  });

  it('builds run command with target and args', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute(
      { action: 'run', target: 'nginx', args: '-p 8080:80' },
      makeCtx(),
    );
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('started'));
      proc.emit('close', 0);
    });

    const result = await promise;
    expect(result).toContain('[退出码: 0]');
    const cmdString = mockSpawn.mock.calls[0][1].join(' ');
    expect(cmdString).toContain('docker run');
    expect(cmdString).toContain('nginx');
    expect(cmdString).toContain('-p 8080:80');
  });

  it('builds stop command with target', async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = dockerTool.execute({ action: 'stop', target: 'mycontainer' }, makeCtx());
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('mycontainer'));
      proc.emit('close', 0);
    });

    await promise;
    const cmdString = mockSpawn.mock.calls[0][1].join(' ');
    expect(cmdString).toContain('docker stop mycontainer');
  });
});
