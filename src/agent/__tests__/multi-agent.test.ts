// src/agent/__tests__/multi-agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentMessageBus, type SubAgentTask } from '../sub-agent.js';

// Mock AgentLoop as a class (hoisted to avoid initialization error)
const { mockRun, MockAgentLoop } = vi.hoisted(() => {
  const mockRun = vi.fn().mockResolvedValue({
    messages: [{ role: 'assistant', content: 'test result' }],
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, cacheHitTokens: 0, cacheMissTokens: 10 },
  });
  class MockAgentLoop {
    run = mockRun;
    constructor(..._args: any[]) {}
  }
  return { mockRun, MockAgentLoop };
});

vi.mock('../loop.js', () => ({
  AgentLoop: MockAgentLoop,
}));

// Import after mock
const { SubAgentManager } = await import('../sub-agent.js');

function makeCtx() {
  return {
    sandbox: { validatePath: () => ({ allowed: true, resolved: '.' }) },
    cwd: '.',
    workingDirectory: '.',
  } as any;
}

function makeMockClient() {
  return { streamChat: vi.fn(), chat: vi.fn(), abort: vi.fn(), isAborted: false } as any;
}

function makeMockTools() {
  return { getDefinitions: () => [], execute: vi.fn() } as any;
}

describe('AgentMessageBus', () => {
  it('sends messages between agents', () => {
    const bus = new AgentMessageBus();
    let received: unknown = null;
    bus.subscribe('agent-2', (from, data) => { received = { from, data }; });
    bus.send('agent-1', 'agent-2', { msg: 'hello' });
    expect(received).toEqual({ from: 'agent-1', data: { msg: 'hello' } });
  });

  it('broadcasts to all except sender', () => {
    const bus = new AgentMessageBus();
    const received: string[] = [];
    bus.subscribe('a', (from) => { received.push('a:' + from); });
    bus.subscribe('b', (from) => { received.push('b:' + from); });
    bus.subscribe('c', (from) => { received.push('c:' + from); });
    bus.broadcast('sender', 'ping');
    // sender is not subscribed, so a, b, c all receive
    expect(received).toEqual(['a:sender', 'b:sender', 'c:sender']);
  });

  it('unsubscribe removes handler', () => {
    const bus = new AgentMessageBus();
    let called = false;
    bus.subscribe('x', () => { called = true; });
    bus.unsubscribe('x');
    bus.send('y', 'x', {});
    expect(called).toBe(false);
  });

  it('counts subscribers', () => {
    const bus = new AgentMessageBus();
    bus.subscribe('a', () => {});
    bus.subscribe('a', () => {});
    bus.subscribe('b', () => {});
    expect(bus.subscriberCount).toBe(3);
  });
});

describe('SubAgentManager', () => {
  let manager: InstanceType<typeof SubAgentManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'test result' }],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, cacheHitTokens: 0, cacheMissTokens: 10 },
    });
    manager = new SubAgentManager(5, 10000, 2);
  });

  it('initializes with zero tasks', () => {
    expect(manager.runningCount).toBe(0);
    expect(manager.pendingCount).toBe(0);
    expect(manager.totalCount).toBe(0);
    expect(manager.getAllTasks()).toEqual([]);
  });

  it('spawns and completes a task', async () => {
    const task = await manager.spawn('test', 'do something', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    expect(task.name).toBe('test');
    expect(manager.totalCount).toBe(1);

    // Wait for completion
    const result = await manager.awaitTask(task.id);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('test result');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.usage?.totalTokens).toBe(30);
  });

  it('tracks task priority', async () => {
    const task = await manager.spawn('high-pri', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent', undefined, { priority: 'high' });
    expect(task.priority).toBe('high');
  });

  it('filters tasks by status', async () => {
    await manager.spawn('task1', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await manager.awaitAll();

    expect(manager.getTasksByStatus('completed').length).toBe(1);
    expect(manager.getTasksByStatus('completed')[0].name).toBe('task1');
    expect(manager.getTasksByStatus('running').length).toBe(0);
  });

  it('aggregates usage across tasks', async () => {
    await manager.spawn('t1', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await manager.spawn('t2', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await manager.awaitAll();

    const usage = manager.getAggregatedUsage();
    expect(usage.promptTokens).toBe(20);
    expect(usage.completionTokens).toBe(40);
    expect(usage.totalTokens).toBe(60);
  });

  it('awaitAll waits for all tasks', async () => {
    await manager.spawn('t1', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await manager.spawn('t2', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');

    await manager.awaitAll();
    const all = manager.getAllTasks();
    expect(all.length).toBe(2);
    expect(all.every(r => r.status === 'completed')).toBe(true);
  });

  it('cancel stops a running task', async () => {
    // Use a slow mock that never resolves
    mockRun.mockReturnValue(new Promise(() => {})); // Never resolves

    const task = await manager.spawn('slow', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    // Small delay to let the task start
    await new Promise(r => setTimeout(r, 50));
    const cancelled = manager.cancel(task.id);
    expect(cancelled).toBe(true);

    const result = await manager.awaitTask(task.id);
    expect(result.status).toBe('cancelled');
  });

  it('cancelAll stops all tasks', async () => {
    mockRun.mockReturnValue(new Promise(() => {})); // Never resolves

    await manager.spawn('t1', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await manager.spawn('t2', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await new Promise(r => setTimeout(r, 50));
    manager.cancelAll();

    await manager.awaitAll();
    const all = manager.getAllTasks();
    expect(all.every(r => r.status === 'cancelled' || r.status === 'completed')).toBe(true);
  });

  it('rejects tasks exceeding nesting depth', async () => {
    const parent = await manager.spawn('parent', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    const child = await manager.spawn('child', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent', undefined, { parentTaskId: parent.id });
    const grandchild = await manager.spawn('grandchild', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent', undefined, { parentTaskId: child.id });
    // depth=3 > maxNestingDepth=2
    const tooDeep = await manager.spawn('toodeep', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent', undefined, { parentTaskId: grandchild.id });
    expect(tooDeep.status).toBe('failed');
    expect(tooDeep.error).toContain('Maximum nesting depth');
  });

  it('respects concurrency limit', async () => {
    const smallManager = new SubAgentManager(2, 10000);
    // All tasks should complete even with limit of 2
    await smallManager.spawn('t1', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await smallManager.spawn('t2', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    await smallManager.spawn('t3', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');

    expect(smallManager.runningCount).toBeLessThanOrEqual(2);
    await smallManager.awaitAll();
    expect(smallManager.getTasksByStatus('completed').length).toBe(3);
  });

  it('handles task failure', async () => {
    mockRun.mockRejectedValue(new Error('API error'));

    const task = await manager.spawn('failing', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent');
    const result = await manager.awaitTask(task.id);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('API error');
  });

  it('onResult callback is called', async () => {
    const onResult = vi.fn();
    await manager.spawn('cb-test', 'test', makeMockClient(), makeMockTools(), makeCtx(), 'agent', onResult);
    await manager.awaitAll();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      name: 'cb-test',
      status: 'completed',
    }));
  });
});

describe('multi_agent tool', () => {
  it('has correct tool definition', async () => {
    const { multiAgentTool } = await import('../../tools/multi-agent.js');
    expect(multiAgentTool.name).toBe('multi_agent');
    expect(multiAgentTool.parameters.required).toContain('tasks');
    expect(multiAgentTool.parameters.required).toContain('strategy');
  });

  it('throws when SubAgentManager not provided', async () => {
    const { multiAgentTool } = await import('../../tools/multi-agent.js');
    await expect(
      multiAgentTool.execute({ tasks: [{ name: 't', prompt: 'p' }], strategy: 'parallel' }, makeCtx())
    ).rejects.toThrow('SubAgentManager 未初始化');
  });

  it('throws when Provider not provided', async () => {
    const { multiAgentTool } = await import('../../tools/multi-agent.js');
    const ctx = { ...makeCtx(), subAgentManager: new SubAgentManager() };
    await expect(
      multiAgentTool.execute({ tasks: [{ name: 't', prompt: 'p' }], strategy: 'parallel' }, ctx)
    ).rejects.toThrow('Provider 未初始化');
  });
});
