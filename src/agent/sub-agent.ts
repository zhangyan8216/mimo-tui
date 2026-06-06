// src/agent/sub-agent.ts - Background sub-agent spawning

import type { Message, TokenUsage } from '../api/types.js';
import { MiMoClient } from '../api/client.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { AgentLoop } from './loop.js';
import type { AgentMode } from '../api/types.js';

export interface SubAgentTask {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  usage?: TokenUsage;
}

export class SubAgentManager {
  private tasks: Map<string, SubAgentTask> = new Map();
  private maxConcurrent: number;
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(maxConcurrent = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  async spawn(
    name: string,
    prompt: string,
    client: MiMoClient,
    tools: ToolRegistry,
    toolContext: ToolContext,
    mode: AgentMode,
    onResult?: (task: SubAgentTask) => void,
  ): Promise<SubAgentTask> {
    const taskId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const task: SubAgentTask = {
      id: taskId,
      name,
      status: 'running',
    };
    this.tasks.set(taskId, task);

    const runTask = async () => {
      this.running++;
      try {
        const loop = new AgentLoop(client, tools, toolContext, 16);
        const userMsg: Message = { role: 'user', content: prompt };

        const result = await loop.run(mode, {
          onToken: () => {},
          onToolStart: () => {},
          onToolResult: () => {},
        }, [userMsg]);

        task.status = 'completed';
        task.result = result.messages[result.messages.length - 1]?.content || '';
        task.usage = result.usage;
      } catch (error) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.running--;
        this.processQueue();
        onResult?.(task);
      }
    };

    if (this.running < this.maxConcurrent) {
      runTask();
    } else {
      this.queue.push(runTask);
    }

    return task;
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  getTask(id: string): SubAgentTask | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): SubAgentTask[] {
    return Array.from(this.tasks.values());
  }

  get runningCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}
