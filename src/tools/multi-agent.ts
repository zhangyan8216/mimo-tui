// src/tools/multi-agent.ts - Multi-agent parallel execution tool
// Allows the AI to autonomously spawn parallel sub-agents for complex tasks

import type { Tool, ToolContext } from './registry.js';
import type { SubAgentManager, SubAgentTask } from '../agent/sub-agent.js';
import type { ProviderAdapter } from '../api/provider.js';
import type { ToolRegistry } from './registry.js';
import type { AgentMode } from '../api/types.js';
import { createProvider } from '../api/providers/index.js';

export interface MultiAgentToolContext extends ToolContext {
  subAgentManager?: SubAgentManager;
  provider?: ProviderAdapter;
  toolRegistry?: ToolRegistry;
  mode?: AgentMode;
}

export const multiAgentTool: Tool = {
  name: 'multi_agent',
  description: `并行执行多个独立任务。支持三种策略:
- parallel: 并行运行所有任务，返回所有结果
- race: 并行运行所有任务，返回第一个成功的结果
- consensus: 对同一任务运行 N 个 agent，返回多数一致的答案

用于需要同时探索多个方向、或需要多个独立视角的复杂任务。`,
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '任务名称（简短标识）' },
            prompt: { type: 'string', description: '任务指令' },
            mode: { type: 'string', enum: ['plan', 'agent', 'yolo'], description: '执行模式（默认继承当前模式）' },
          },
          required: ['name', 'prompt'],
        },
        description: '任务列表。parallel/race 模式下每个任务独立；consensus 模式下所有任务共用同一个 prompt',
        minItems: 1,
        maxItems: 10,
      },
      strategy: {
        type: 'string',
        enum: ['parallel', 'race', 'consensus'],
        description: '执行策略: parallel(全部并行), race(取第一个成功), consensus(多数投票)',
      },
      aggregatePrompt: {
        type: 'string',
        description: '（可选）结果聚合指令。如不提供，自动合并所有结果',
      },
      consensusRuns: {
        type: 'number',
        description: 'consensus 模式下运行次数（默认 3）',
      },
    },
    required: ['tasks', 'strategy'],
  },
  requiresApproval: false,

  async execute(args: Record<string, unknown>, ctx: MultiAgentToolContext): Promise<string> {
    const tasks = args.tasks as Array<{ name: string; prompt: string; mode?: string }>;
    const strategy = args.strategy as 'parallel' | 'race' | 'consensus';
    const aggregatePrompt = args.aggregatePrompt as string | undefined;
    const consensusRuns = (args.consensusRuns as number) || 3;

    if (!ctx.subAgentManager) {
      throw new Error('SubAgentManager 未初始化。multi_agent 工具需要 SubAgentManager。');
    }
    if (!ctx.provider) {
      throw new Error('Provider 未初始化。multi_agent 工具需要 API Provider。');
    }
    if (!ctx.toolRegistry) {
      throw new Error('ToolRegistry 未初始化。');
    }

    const manager = ctx.subAgentManager;
    const client = ctx.provider;
    const tools = ctx.toolRegistry;
    const defaultMode = ctx.mode || 'agent';

    switch (strategy) {
      case 'parallel':
        return executeParallel(manager, client, tools, ctx, tasks, defaultMode, aggregatePrompt);
      case 'race':
        return executeRace(manager, client, tools, ctx, tasks, defaultMode);
      case 'consensus':
        return executeConsensus(manager, client, tools, ctx, tasks, defaultMode, consensusRuns, aggregatePrompt);
      default:
        throw new Error(`未知策略: ${strategy}。支持: parallel, race, consensus`);
    }
  },
};

// ─── Strategy: Parallel — run all tasks, return all results ──────────

async function executeParallel(
  manager: SubAgentManager,
  client: ProviderAdapter,
  tools: ToolRegistry,
  ctx: MultiAgentToolContext,
  tasks: Array<{ name: string; prompt: string; mode?: string }>,
  defaultMode: AgentMode,
  aggregatePrompt?: string,
): Promise<string> {
  const spawned: SubAgentTask[] = [];

  for (const task of tasks) {
    const t = await manager.spawn(
      task.name,
      task.prompt,
      client,
      tools,
      ctx,
      (task.mode as AgentMode) || defaultMode,
    );
    spawned.push(t);
  }

  // Wait for all tasks to complete
  const results = await Promise.all(spawned.map(t => manager.awaitTask(t.id)));

  // Format results
  const formatted = results.map(r => {
    const status = r.status === 'completed' ? '✅' : r.status === 'cancelled' ? '⏹️' : '❌';
    const content = r.status === 'completed' ? r.result : `(${r.error || '未知错误'})`;
    const duration = r.duration ? ` [${(r.duration / 1000).toFixed(1)}s]` : '';
    return `${status} **${r.name}**${duration}\n${content}`;
  });

  const completed = results.filter(r => r.status === 'completed').length;
  const summary = `\n---\n📊 ${completed}/${results.length} 个任务完成`;

  if (aggregatePrompt && completed > 0) {
    const combinedResults = results
      .filter(r => r.status === 'completed')
      .map(r => `### ${r.name}\n${r.result}`)
      .join('\n\n');
    return `## 并行任务结果\n\n${formatted.join('\n\n')}\n\n${summary}\n\n## 聚合分析\n\n以下是所有成功结果的汇总:\n\n${combinedResults}\n\n请根据以上结果: ${aggregatePrompt}`;
  }

  return `## 并行任务结果\n\n${formatted.join('\n\n')}\n${summary}`;
}

// ─── Strategy: Race — run all, return first success ──────────────────

async function executeRace(
  manager: SubAgentManager,
  client: ProviderAdapter,
  tools: ToolRegistry,
  ctx: MultiAgentToolContext,
  tasks: Array<{ name: string; prompt: string; mode?: string }>,
  defaultMode: AgentMode,
): Promise<string> {
  const spawned: SubAgentTask[] = [];

  for (const task of tasks) {
    const t = await manager.spawn(
      task.name,
      task.prompt,
      client,
      tools,
      ctx,
      (task.mode as AgentMode) || defaultMode,
    );
    spawned.push(t);
  }

  // Wait for the first successful result
  const winner = await new Promise<SubAgentTask>((resolve) => {
    let resolved = false;
    for (const t of spawned) {
      manager.awaitTask(t.id).then(result => {
        if (!resolved && result.status === 'completed') {
          resolved = true;
          // Cancel remaining tasks
          for (const other of spawned) {
            if (other.id !== result.id) manager.cancel(other.id);
          }
          resolve(result);
        }
      }).catch(() => {});
    }

    // If all fail, resolve with last failed
    Promise.all(spawned.map(t => manager.awaitTask(t.id))).then(results => {
      if (!resolved) {
        resolved = true;
        resolve(results[results.length - 1]);
      }
    }).catch(() => {});
  });

  const duration = winner.duration ? ` [${(winner.duration / 1000).toFixed(1)}s]` : '';
  const status = winner.status === 'completed' ? '✅' : '❌';
  return `## 竞速结果\n\n${status} 胜出者: **${winner.name}**${duration}\n\n${winner.result || winner.error || '无结果'}`;
}

// ─── Strategy: Consensus — run N agents on same task, majority vote ──

async function executeConsensus(
  manager: SubAgentManager,
  client: ProviderAdapter,
  tools: ToolRegistry,
  ctx: MultiAgentToolContext,
  tasks: Array<{ name: string; prompt: string; mode?: string }>,
  defaultMode: AgentMode,
  consensusRuns: number,
  aggregatePrompt?: string,
): Promise<string> {
  // For consensus, use the first task's prompt and run it N times
  const basePrompt = tasks[0].prompt;
  const spawned: SubAgentTask[] = [];

  for (let i = 0; i < consensusRuns; i++) {
    const t = await manager.spawn(
      `consensus-${i + 1}`,
      basePrompt,
      client,
      tools,
      ctx,
      (tasks[0].mode as AgentMode) || defaultMode,
    );
    spawned.push(t);
  }

  const results = await Promise.all(spawned.map(t => manager.awaitTask(t.id)));
  const completed = results.filter(r => r.status === 'completed');

  if (completed.length === 0) {
    return `## 共识结果\n\n❌ 所有 ${consensusRuns} 个 agent 均失败`;
  }

  const formatted = completed.map((r, i) =>
    `### Agent ${i + 1}\n${r.result}`
  ).join('\n\n');

  if (aggregatePrompt) {
    return `## 共识结果 (${completed.length}/${consensusRuns} 成功)\n\n${formatted}\n\n---\n请分析以上 ${completed.length} 个独立回答，找出共识和分歧，然后: ${aggregatePrompt}`;
  }

  return `## 共识结果 (${completed.length}/${consensusRuns} 成功)\n\n${formatted}\n\n---\n以上是 ${completed.length} 个独立 agent 的回答。请对比分析，找出共识和分歧点。`;
}
