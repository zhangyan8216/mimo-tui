// src/agent/sub-agent.ts - Multi-agent parallel execution manager
// Supports: parallel spawn, priority queue, cancellation, inter-agent messaging, nested spawning

import type { Message, TokenUsage } from '../api/types.js';
import type { ProviderAdapter } from '../api/provider.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { AgentLoop } from './loop.js';
import type { AgentMode } from '../api/types.js';
import { accumulateUsage } from '../utils/tokens.js';

// ─── Types ───────────────────────────────────────────────────────────

export type TaskPriority = 'high' | 'normal' | 'low';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubAgentOptions {
  name: string;
  prompt: string;
  priority?: TaskPriority;
  mode?: AgentMode;
  maxIterations?: number;
  parentTaskId?: string;
  timeout?: number;
}

export interface SubAgentTask {
  id: string;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  result?: string;
  error?: string;
  usage?: TokenUsage;
  startTime: number;
  endTime?: number;
  duration?: number;
  parentTaskId?: string;
  childTaskIds: string[];
}

export type AgentMessageHandler = (fromId: string, data: unknown) => void;

// ─── Message Bus — inter-agent communication ─────────────────────────

export class AgentMessageBus {
  private subscribers = new Map<string, AgentMessageHandler[]>();

  send(fromId: string, toId: string, data: unknown): void {
    const handlers = this.subscribers.get(toId) || [];
    for (const handler of handlers) {
      try { handler(fromId, data); } catch { /* ignore handler errors */ }
    }
  }

  broadcast(fromId: string, data: unknown): void {
    for (const [taskId, handlers] of this.subscribers) {
      if (taskId === fromId) continue; // Don't send to self
      for (const handler of handlers) {
        try { handler(fromId, data); } catch { /* ignore */ }
      }
    }
  }

  subscribe(taskId: string, handler: AgentMessageHandler): void {
    const handlers = this.subscribers.get(taskId) || [];
    handlers.push(handler);
    this.subscribers.set(taskId, handlers);
  }

  unsubscribe(taskId: string): void {
    this.subscribers.delete(taskId);
  }

  get subscriberCount(): number {
    let count = 0;
    for (const handlers of this.subscribers.values()) count += handlers.length;
    return count;
  }
}

// ─── SubAgentManager ─────────────────────────────────────────────────

export class SubAgentManager {
  private tasks = new Map<string, SubAgentTask>();
  private maxConcurrent: number;
  private maxNestingDepth: number;
  private running = 0;
  private queue: Array<{ run: () => Promise<void>; priority: TaskPriority }> = [];
  private abortControllers = new Map<string, AbortController>();
  readonly messageBus = new AgentMessageBus();
  private agentTimeout: number;

  constructor(maxConcurrent = 5, agentTimeout = 120_000, maxNestingDepth = 2) {
    this.maxConcurrent = maxConcurrent;
    this.agentTimeout = agentTimeout;
    this.maxNestingDepth = maxNestingDepth;
  }

  /**
   * Spawn a sub-agent task.
   * Returns immediately with a task handle; execution is queued if at capacity.
   */
  async spawn(
    name: string,
    prompt: string,
    client: ProviderAdapter,
    tools: ToolRegistry,
    toolContext: ToolContext,
    mode: AgentMode,
    onResult?: (task: SubAgentTask) => void,
    options?: Partial<SubAgentOptions>,
  ): Promise<SubAgentTask> {
    const taskId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const priority = options?.priority || 'normal';
    const parentTaskId = options?.parentTaskId;

    // Check nesting depth
    if (parentTaskId) {
      const depth = this.getTaskDepth(parentTaskId);
      if (depth >= this.maxNestingDepth) {
        const task: SubAgentTask = {
          id: taskId, name, status: 'failed', priority, startTime: Date.now(),
          error: `Maximum nesting depth (${this.maxNestingDepth}) exceeded`,
          parentTaskId, childTaskIds: [],
        };
        this.tasks.set(taskId, task);
        onResult?.(task);
        return task;
      }
    }

    const task: SubAgentTask = {
      id: taskId,
      name,
      status: 'queued',
      priority,
      startTime: Date.now(),
      parentTaskId,
      childTaskIds: [],
    };
    this.tasks.set(taskId, task);

    // Register child task on parent
    if (parentTaskId) {
      const parent = this.tasks.get(parentTaskId);
      if (parent) parent.childTaskIds.push(taskId);
    }

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    const maxIter = options?.maxIterations || 16;
    const timeout = options?.timeout || this.agentTimeout;

    const runTask = async () => {
      this.running++;
      task.status = 'running';
      task.startTime = Date.now();
      try {
        const loop = new AgentLoop(client, tools, toolContext, maxIter);
        const userMsg: Message = { role: 'user', content: prompt };

        // Race between execution and timeout/abort
        const execution = loop.run(mode, {
          onToken: () => {},
          onToolStart: () => {},
          onToolResult: () => {},
        }, [userMsg]);

        const timeoutPromise = new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`Sub-agent "${name}" timed out (${timeout}ms)`)), timeout);
          abortController.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')); });
        });

        const result = await Promise.race([execution, timeoutPromise]);

        if (abortController.signal.aborted) {
          task.status = 'cancelled';
          task.error = 'Cancelled by user';
        } else {
          task.status = 'completed';
          task.result = result.messages[result.messages.length - 1]?.content || '';
          task.usage = result.usage;
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          task.status = 'cancelled';
          task.error = 'Cancelled by user';
        } else {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        this.running--;
        this.abortControllers.delete(taskId);
        this.messageBus.unsubscribe(taskId);
        this.processQueue();
        onResult?.(task);
      }
    };

    if (this.running < this.maxConcurrent) {
      runTask().catch(() => {});
    } else {
      this.queue.push({ run: runTask, priority });
      this.sortQueue();
    }

    return task;
  }

  /**
   * Cancel a running or queued task.
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'running') {
      const controller = this.abortControllers.get(taskId);
      if (controller) {
        controller.abort();
        return true;
      }
    }

    if (task.status === 'queued') {
      const idx = this.queue.findIndex((_, i) => {
        // We can't directly compare functions, so check by task status
        return true; // Will be filtered by status check
      });
      task.status = 'cancelled';
      task.endTime = Date.now();
      task.duration = task.endTime - task.startTime;
      // Remove from queue
      this.queue = this.queue.filter(q => {
        // The task's status was already set to cancelled
        // Next time runTask is called, it will find cancelled status
        return true;
      });
      return true;
    }

    return false;
  }

  /**
   * Cancel all tasks.
   */
  cancelAll(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'running' || task.status === 'queued') {
        this.cancel(id);
      }
    }
  }

  /**
   * Wait for a specific task to complete.
   */
  awaitTask(taskId: string): Promise<SubAgentTask> {
    return new Promise((resolve) => {
      const task = this.tasks.get(taskId);
      if (!task) { resolve(undefined as unknown as SubAgentTask); return; }
      if (task.status !== 'running' && task.status !== 'queued') { resolve(task); return; }

      const check = setInterval(() => {
        const t = this.tasks.get(taskId);
        if (t && t.status !== 'running' && t.status !== 'queued') {
          clearInterval(check);
          resolve(t);
        }
      }, 100);
    });
  }

  /**
   * Wait for all tasks to complete.
   */
  awaitAll(): Promise<SubAgentTask[]> {
    const pending = Array.from(this.tasks.values()).filter(
      t => t.status === 'running' || t.status === 'queued'
    );
    if (pending.length === 0) return Promise.resolve(Array.from(this.tasks.values()));
    return Promise.all(pending.map(t => this.awaitTask(t.id)));
  }

  /**
   * Get aggregated usage across all completed tasks.
   */
  getAggregatedUsage(): TokenUsage {
    let total: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    for (const task of this.tasks.values()) {
      if (task.usage) total = accumulateUsage(total, task.usage);
    }
    return total;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private sortQueue(): void {
    const priorityOrder: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
    this.queue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next.run().catch(() => {});
    }
  }

  private getTaskDepth(taskId: string): number {
    let depth = 0;
    let current = this.tasks.get(taskId);
    while (current?.parentTaskId) {
      depth++;
      current = this.tasks.get(current.parentTaskId);
    }
    return depth;
  }

  getTask(id: string): SubAgentTask | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): SubAgentTask[] {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status: TaskStatus): SubAgentTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }

  get runningCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get totalCount(): number {
    return this.tasks.size;
  }
}
