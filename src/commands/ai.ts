// src/commands/ai.ts - AI capability commands (workflow, parallel, pipeline, etc.)

import fs from 'fs';
import path from 'path';
import { createProvider } from '../api/providers/index.js';
import { BUILTIN_WORKFLOWS, searchWorkflows } from '../utils/workflow.js';
import type { CommandContext } from './types.js';

// Load user-defined workflows from .mimo/workflows.json
interface UserWorkflowStep {
  name: string;
  prompt: string;
}

interface UserWorkflow {
  id: string;
  name: string;
  description: string;
  steps: UserWorkflowStep[];
}

interface UserWorkflowsConfig {
  workflows: UserWorkflow[];
}

function loadUserWorkflows(): import('../utils/workflow.js').Workflow[] {
  try {
    const workflowsPath = path.join(process.cwd(), '.mimo', 'workflows.json');
    if (fs.existsSync(workflowsPath)) {
      const content = fs.readFileSync(workflowsPath, 'utf-8');
      const config: UserWorkflowsConfig = JSON.parse(content);
      if (config.workflows && Array.isArray(config.workflows)) {
        return config.workflows.map((wf, idx) => ({
          id: wf.id,
          name: wf.name,
          description: wf.description,
          steps: wf.steps.map((step, stepIdx) => ({
            id: `${wf.id}-step-${stepIdx}`,
            name: step.name,
            prompt: step.prompt,
          })),
        }));
      }
    }
  } catch (e) {
    // Silently ignore parse errors for user workflows
  }
  return [];
}

export function handleAICommand(cmd: string, cmdArgs: string[], ctx: CommandContext): void {
  const { setMessages, configRef, modeRef, handleSubmit, subAgentManager, sandbox, toolRegistry, activeWorkflow, agentLoop, fileWatcher, autoCommit, autoTest, setIsStreaming, setIsThinking, streamTimerRef } = ctx;

  switch (cmd) {
    case 'workflow':
    case 'wf': {
      const sub = cmdArgs[0] || 'list';
      if (sub === 'list') {
        const lines = ['⚡ **工作流**\n'];
        const userWfs = loadUserWorkflows();
        if (userWfs.length > 0) {
          lines.push('**自定义工作流** (来自 .mimo/workflows.json)');
          for (const wf of userWfs) {
            lines.push(`\`${wf.id}\` **${wf.name}** - ${wf.description}`);
            lines.push(`  步骤: ${wf.steps.map(s => s.name).join(' → ')}`);
          }
          lines.push('');
        }
        lines.push('**内置工作流**');
        for (const wf of BUILTIN_WORKFLOWS) {
          lines.push(`\`${wf.id}\` **${wf.name}** - ${wf.description}`);
          lines.push(`  步骤: ${wf.steps.map(s => s.name).join(' → ')}`);
        }
        lines.push('\n用法: `/wf <id>` 执行工作流 · `/wf stop` 停止');
        setMessages(prev => [...prev, { role: 'assistant', content: lines.join('\n') }]);
      } else if (sub === 'stop') {
        if (activeWorkflow.current) {
          const wfName = activeWorkflow.current.workflow.name;
          activeWorkflow.current = null;
          setMessages(prev => [...prev, { role: 'assistant', content: `⏹️ 工作流 "${wfName}" 已停止` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '没有正在运行的工作流' }]);
        }
      } else if (sub === 'search') {
        const query = cmdArgs.slice(1).join(' ');
        const results = searchWorkflows(query);
        const list = results.map(w => `\`${w.id}\` ${w.name}: ${w.description}`).join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: list || '未找到匹配的工作流' }]);
      } else {
        const userWfs = loadUserWorkflows();
        const wf = userWfs.find(w => w.id === sub) || BUILTIN_WORKFLOWS.find(w => w.id === sub);
        if (wf) {
          activeWorkflow.current = { workflow: wf, stepIndex: 0 };
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚡ 执行工作流: **${wf.name}**\n步骤: ${wf.steps.map(s => s.name).join(' → ')}\n\n开始第 1/${wf.steps.length} 步: ${wf.steps[0].name}`,
          }]);
          setTimeout(() => handleSubmit(wf.steps[0].prompt), 500);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: `❓ 工作流 "${sub}" 不存在。输入 \`/wf\` 查看所有工作流` }]);
        }
      }
      break;
    }

    case 'parallel': {
      const tasks = cmdArgs.join(' ').split('|').map(t => t.trim()).filter(Boolean);
      if (tasks.length < 2) {
        setMessages(prev => [...prev, { role: 'assistant', content: '🔀 用法: `/parallel 任务1 | 任务2 | 任务3`\n并行执行多个独立任务' }]);
        break;
      }
      const cfg = configRef.current;
      const client = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
      const toolCtx = { sandbox: sandbox.current, cwd: process.cwd(), workingDirectory: process.cwd() };
      setMessages(prev => [...prev, { role: 'assistant', content: `🔀 并行执行 ${tasks.length} 个任务...` }]);

      let completed = 0;
      for (const [i, task] of tasks.entries()) {
        subAgentManager.current?.spawn(`parallel-${i+1}`, task, client, toolRegistry.current, toolCtx, modeRef.current, (result) => {
          completed++;
          const status = result.status === 'completed' ? '✅' : '❌';
          setMessages(prev => [...prev, { role: 'assistant', content: `${status} 任务 ${i+1}/${tasks.length}: ${task.slice(0, 30)}...\n${(result.result || result.error || '').slice(0, 300)}` }]);
          if (completed === tasks.length) {
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ 全部 ${tasks.length} 个并行任务已完成` }]);
          }
        });
      }
      break;
    }

    case 'pipeline': {
      const stages = cmdArgs.join(' ').split('->').map(s => s.trim()).filter(Boolean);
      if (stages.length < 2) {
        setMessages(prev => [...prev, { role: 'assistant', content: '🔗 用法: `/pipeline 探索代码 -> 分析问题 -> 生成修复方案`\n任务按顺序执行，前一步的输出作为后一步的输入' }]);
        break;
      }
      const cfg = configRef.current;
      const client = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
      const toolCtx = { sandbox: sandbox.current, cwd: process.cwd(), workingDirectory: process.cwd() };

      setMessages(prev => [...prev, { role: 'assistant', content: `🔗 管道执行 ${stages.length} 个阶段:\n${stages.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` }]);

      const runStage = (stageIndex: number, previousResult: string) => {
        if (stageIndex >= stages.length) {
          setMessages(prev => [...prev, { role: 'assistant', content: `✅ 管道全部 ${stages.length} 个阶段已完成` }]);
          return;
        }
        const stagePrompt = stageIndex === 0
          ? `请执行以下任务:\n${stages[stageIndex]}`
          : `前一阶段的执行结果:\n${previousResult.slice(0, 2000)}\n\n请基于以上结果，执行以下任务:\n${stages[stageIndex]}`;

        setMessages(prev => [...prev, { role: 'assistant', content: `🔗 正在执行阶段 ${stageIndex + 1}/${stages.length}: ${stages[stageIndex].slice(0, 50)}...` }]);

        subAgentManager.current?.spawn(
          `pipeline-${stageIndex + 1}`,
          stagePrompt,
          client,
          toolRegistry.current,
          toolCtx,
          modeRef.current,
          (result) => {
            const status = result.status === 'completed' ? '✅' : '❌';
            const stageResult = result.result || result.error || '无结果';
            setMessages(prev => [...prev, { role: 'assistant', content: `${status} 阶段 ${stageIndex + 1}/${stages.length} 完成\n${stageResult.slice(0, 300)}` }]);
            if (result.status === 'completed' && stageIndex + 1 < stages.length) {
              runStage(stageIndex + 1, stageResult);
            } else if (stageIndex + 1 >= stages.length) {
              setMessages(prev => [...prev, { role: 'assistant', content: `✅ 管道全部 ${stages.length} 个阶段已完成` }]);
            }
          }
        );
      };

      runStage(0, '');
      break;
    }

    case 'explore': {
      const topic = cmdArgs.join(' ');
      if (!topic) {
        setMessages(prev => [...prev, { role: 'assistant', content: '🔍 用法: `/explore <主题>`\n示例: `/explore 错误处理逻辑`' }]);
        break;
      }
      const cfg = configRef.current;
      const client = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
      const toolCtx = { sandbox: sandbox.current, cwd: process.cwd(), workingDirectory: process.cwd() };
      setMessages(prev => [...prev, { role: 'assistant', content: `🔍 正在探索: ${topic}` }]);
      subAgentManager.current?.spawn(`explore-${topic.slice(0, 20)}`, `请用 codebase 和 read_file 工具探索项目，回答以下问题: ${topic}. 只读取和分析，不要修改任何文件。`, client, toolRegistry.current, toolCtx, 'plan', (result) => {
        const status = result.status === 'completed' ? '✅' : '❌';
        setMessages(prev => [...prev, { role: 'assistant', content: `${status} 探索完成: ${topic}\n${(result.result || result.error || '').slice(0, 500)}` }]);
      });
      break;
    }

    case 'review': {
      const target = cmdArgs.join(' ') || '最近的代码变更';
      const cfg = configRef.current;
      const client = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
      const toolCtx = { sandbox: sandbox.current, cwd: process.cwd(), workingDirectory: process.cwd() };
      setMessages(prev => [...prev, { role: 'assistant', content: `🔍 正在审查: ${target}` }]);
      subAgentManager.current?.spawn(`review-${target.slice(0, 20)}`, `请审查 ${target} 的代码质量。检查: 1) 潜在的 bug 2) 性能问题 3) 安全隐患 4) 代码风格 5) 可改进建议。给出具体的问题描述和修复建议。`, client, toolRegistry.current, toolCtx, modeRef.current, (result) => {
        const status = result.status === 'completed' ? '✅' : '❌';
        setMessages(prev => [...prev, { role: 'assistant', content: `${status} 代码审查完成: ${target}\n${(result.result || result.error || '').slice(0, 500)}` }]);
      });
      break;
    }

    case 'sub': {
      const taskName = cmdArgs[0] || 'background-task';
      const taskPrompt = cmdArgs.slice(1).join(' ');
      if (!taskPrompt) {
        setMessages(prev => [...prev, { role: 'assistant', content: '🔀 用法: `/sub <名称> <任务描述>`\n示例: `/sub test-check 检查所有测试是否通过`' }]);
        break;
      }
      const cfg = configRef.current;
      const client = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
      const toolCtx = { sandbox: sandbox.current, cwd: process.cwd(), workingDirectory: process.cwd() };
      setMessages(prev => [...prev, { role: 'assistant', content: `🔀 后台任务 **${taskName}** 已启动` }]);
      subAgentManager.current?.spawn(taskName, taskPrompt, client, toolRegistry.current, toolCtx, modeRef.current, (task) => {
        const status = task.status === 'completed' ? '✅' : '❌';
        const content = task.result || task.error || '无结果';
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `${status} 后台任务 **${taskName}** 已完成\n\n${content.slice(0, 500)}`,
        }]);
      });
      break;
    }

    case 'status': {
      const allTasks = subAgentManager.current?.getAllTasks() || [];
      if (allTasks.length === 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: '📊 没有后台任务' }]);
        break;
      }
      const lines = allTasks.map(t => {
        const icon = t.status === 'running' ? '🔄' : t.status === 'completed' ? '✅' : '❌';
        return `${icon} ${t.name} [${t.status}]`;
      });
      setMessages(prev => [...prev, { role: 'assistant', content: `📊 **后台任务** (${subAgentManager.current?.runningCount || 0} 运行中)\n${lines.join('\n')}` }]);
      break;
    }

    case 'kill': {
      const stopped: string[] = [];

      if (activeWorkflow.current) {
        stopped.push(`工作流: ${activeWorkflow.current.workflow.name}`);
        activeWorkflow.current = null;
      }

      if (agentLoop.current) {
        agentLoop.current.abort();
        stopped.push('当前 AI 对话');
      }

      fileWatcher.current?.stop();
      if (fileWatcher.current) stopped.push('文件监控');

      setIsStreaming(false);
      setIsThinking(false);
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }

      if (stopped.length === 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: '🛑 没有正在运行的任务' }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `🛑 已停止:\n${stopped.map(s => `  • ${s}`).join('\n')}` }]);
      }
      break;
    }

    case 'improve': {
      const target = cmdArgs.join(' ');
      const prompt = target
        ? `请分析文件 ${target} 的代码质量，找出问题并给出具体改进建议。用 read_file 读取文件，然后逐项分析。`
        : '请分析当前项目的代码质量：1) 用 codebase action=index 了解项目结构 2) 检查是否有未使用的依赖 3) 检查是否有缺少的类型注解 4) 检查是否有可以提取的重复代码 5) 检查测试覆盖率。给出具体改进建议，包含文件路径和行号。';
      setMessages(prev => [...prev, { role: 'assistant', content: `🔍 正在分析${target ? ` ${target}` : '项目'}...` }]);
      setTimeout(() => handleSubmit(prompt), 100);
      break;
    }

    case 'batch': {
      const commands = cmdArgs.join(' ');
      if (!commands) {
        setMessages(prev => [...prev, { role: 'assistant', content: '📦 用法: `/batch npm test && npm run build && git status`' }]);
        break;
      }
      const prompt = `请依次执行以下命令，每条命令用 shell 工具执行，如果某条命令失败则停止并报告错误:\n\n${commands.split('&&').map((c, i) => `${i + 1}. ${c.trim()}`).join('\n')}`;
      setMessages(prev => [...prev, { role: 'assistant', content: `📦 批量执行 ${commands.split('&&').length} 条命令...` }]);
      setTimeout(() => handleSubmit(prompt), 100);
      break;
    }
  }
}
