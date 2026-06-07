// src/tui/App.tsx - Root Ink component

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import fs from 'fs';
import path from 'path';
import type { Config } from '../config.js';
import { saveConfig, DEFAULT_CONFIG } from '../config.js';
import type { Message, TokenUsage, AgentMode, Skill } from '../api/types.js';
import type { Theme } from './theme.js';
import { getTheme } from './theme.js';
import { createProvider } from '../api/providers/index.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { readFileTool } from '../tools/read-file.js';
import { writeFileTool } from '../tools/write-file.js';
import { editFileTool } from '../tools/edit-file.js';
import { shellTool } from '../tools/shell.js';
import { globTool } from '../tools/glob.js';
import { grepTool } from '../tools/grep.js';
import { webFetchTool } from '../tools/web-fetch.js';
import { todoTool } from '../tools/todo.js';
import { codebaseTool } from '../tools/codebase.js';
import { testRunnerTool } from '../tools/test-runner.js';
import { multiEditTool } from '../tools/multi-edit.js';
import { dockerTool } from '../tools/docker.js';
import { coverageTool } from '../tools/coverage.js';
import { databaseTool } from '../tools/database.js';
import { codeReviewTool } from '../tools/code-review.js';
import { benchmarkTool } from '../tools/benchmark.js';
import { monitor } from '../utils/monitor.js';
import { AgentLoop } from '../agent/loop.js';
import { compactContext, needsCompaction } from '../agent/compact.js';
import { Sandbox } from '../utils/sandbox.js';
import { SessionManager } from '../session/manager.js';
import { loadSkills, findSkillByTrigger } from '../skills/loader.js';
import { getGitInfo, getGitDiff, getRecentCommits } from '../utils/git.js';
import { detectProject, formatProjectSummary } from '../utils/project.js';
import { exportConversation } from '../utils/export.js';
import { generateFileTree, formatFileTree } from '../utils/filetree.js';
import { CommandHistory } from '../utils/history.js';
import { notifyComplete } from '../utils/notify.js';
import { checkApiHealth } from '../utils/health.js';
import { SnippetLibrary } from '../utils/snippets.js';
import { TEMPLATES, getTemplatesByCategory, searchTemplates } from '../utils/templates.js';
import { calculateCost, logCost, getCostSummary } from '../utils/cost.js';
import { MemoryStore } from '../utils/memory.js';
import { BUILTIN_WORKFLOWS, type Workflow, searchWorkflows } from '../utils/workflow.js';
import { FileWatcher } from '../utils/watcher.js';
import { generateSuggestions } from '../utils/suggestions.js';
import { buildProjectContext, extractRelevantContext, type ProjectContext } from '../utils/context.js';
import { buildSystemPrompt, extractRecentErrors } from '../utils/prompt-builder.js';
import { MCPClient } from '../mcp/client.js';
import { SubAgentManager } from '../agent/sub-agent.js';
import { PluginManager } from '../plugins/manager.js';
import { KnowledgeBase } from '../utils/knowledge-base.js';
import { ChatView } from './ChatView.js';
import { InputArea } from './InputArea.js';
import { StatusBar } from './StatusBar.js';
import { CommandPalette } from './CommandPalette.js';
import { SessionPicker } from './SessionPicker.js';
import { SetupWizard } from './SetupWizard.js';
import { HelpOverlay } from './HelpOverlay.js';
import { ApprovalDialog } from './ApprovalDialog.js';

interface AppState {
  config: Config;
  needsSetup: boolean;
  initialPrompt?: string;
}

type Overlay = 'none' | 'command_palette' | 'session_picker' | 'help' | 'setup';

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0, completionTokens: 0, totalTokens: 0,
  cacheHitTokens: 0, cacheMissTokens: 0,
};

// Interface for user-defined workflow steps from .mimo/workflows.json
interface UserWorkflowStep {
  name: string;
  prompt: string;
}

// Interface for user-defined workflows from .mimo/workflows.json
interface UserWorkflow {
  id: string;
  name: string;
  description: string;
  steps: UserWorkflowStep[];
}

interface UserWorkflowsConfig {
  workflows: UserWorkflow[];
}

// Load user-defined workflows from .mimo/workflows.json
function loadUserWorkflows(): Workflow[] {
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

export const App: React.FC<AppState> = ({ config: initialConfig, needsSetup, initialPrompt }) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [theme] = useState<Theme>(getTheme(initialConfig.ui.theme));
  const [messages, setMessages] = useState<Message[]>([]);
  const [usage, setUsage] = useState<TokenUsage>({ ...EMPTY_USAGE });
  const [mode, setMode] = useState<AgentMode>(initialConfig.agent.mode);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(needsSetup ? 'setup' : 'none');
  const [sessions, setSessions] = useState<ReturnType<SessionManager['listSessions']>>([]);

  // 流式输出节流：用 ref 累积 token，定时批量刷新到 state (防闪烁)
  const streamBufferRef = useRef({ content: '', thinking: '', dirty: false });
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [approvalPending, setApprovalPending] = useState<{
    toolName: string;
    args: Record<string, unknown>;
    resolve: (approved: boolean) => void;
  } | null>(null);
  const [toolResults, setToolResults] = useState<Map<string, { result?: string; error?: string; status: 'running' | 'completed' | 'failed' }>>(new Map());
  const [streamingToolCalls, setStreamingToolCalls] = useState<Map<number, { name: string; args: string }>>(new Map());
  const [iteration, setIteration] = useState(0);
  const [gitBranch, setGitBranch] = useState<string>('');
  const [gitDirty, setGitDirty] = useState(false);

  // Refs
  const sessionManager = useRef(new SessionManager());
  const agentLoop = useRef<AgentLoop | null>(null);
  const skills = useRef<Skill[]>([]);
  const alwaysApprovedTools = useRef<Set<string>>(new Set());
  const messagesRef = useRef<Message[]>([]);
  const modeRef = useRef<AgentMode>(mode);
  const configRef = useRef<Config>(config);
  const commandHistory = useRef(new CommandHistory());
  const snippetLibrary = useRef(new SnippetLibrary());
  const memoryStore = useRef(new MemoryStore());
  const fileWatcher = useRef(new FileWatcher());
  const mcpClient = useRef<MCPClient>(new MCPClient());
  const subAgentManager = useRef(new SubAgentManager(3));
  const pluginManager = useRef<PluginManager | null>(null);
  const knowledgeBase = useRef(new KnowledgeBase());
  const activeWorkflow = useRef<{ workflow: Workflow; stepIndex: number } | null>(null);
  const autoCommit = useRef(false);
  const isAutoCommitting = useRef(false);
  const autoTest = useRef(false);
  const [fileChanges, setFileChanges] = useState<string>('');

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { configRef.current = config; }, [config]);

  // Initialize tools
  const toolRegistry = useRef<ToolRegistry>((() => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);
    registry.register(editFileTool);
    registry.register(shellTool);
    registry.register(globTool);
    registry.register(grepTool);
    registry.register(webFetchTool);
    registry.register(todoTool);
    registry.register(codebaseTool);
    registry.register(testRunnerTool);
    registry.register(multiEditTool);
    registry.register(dockerTool);
    registry.register(coverageTool);
    registry.register(databaseTool);
    registry.register(codeReviewTool);
    registry.register(benchmarkTool);
    return registry;
  })());

  const sandbox = useRef(new Sandbox(process.cwd()));
  const projectCtx = useRef<ProjectContext | null>(null);

  // 加载系统提示词
  const systemPrompt = useRef<string>('');
  useEffect(() => {
    // 按优先级查找系统提示词
    const candidates = [
      path.join(process.cwd(), '.mimo', 'system.md'),
      path.join(process.cwd(), '.mimo', 'prompts', 'system.md'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.mimo', 'system.md'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          systemPrompt.current = fs.readFileSync(p, 'utf-8');
          return;
        }
      } catch { /* ignore */ }
    }
    // 默认提示词
    systemPrompt.current = '你是 MiMo，一个运行在终端里的 AI 编程助手。用中文回答，简洁直接。';
  }, []);

  // 构建项目上下文（文件树、依赖、配置等）
  useEffect(() => {
    try {
      projectCtx.current = buildProjectContext(process.cwd());
    } catch { /* ignore */ }
  }, []);

  // 检测 Git 状态
  useEffect(() => {
    getGitInfo().then(info => {
      setGitBranch(info.branch);
      setGitDirty(info.dirty);
    }).catch(() => {});
  }, []);

  // Load skills
  useEffect(() => {
    skills.current = loadSkills(process.cwd());
  }, []);

  // Connect MCP servers and register their tools
  useEffect(() => {
    const mcp = mcpClient.current;
    const registry = toolRegistry.current;
    const servers = config.mcp.servers;
    if (servers.length === 0) return;

    (async () => {
      for (const serverCfg of servers) {
        try {
          await mcp.connectServer(serverCfg);
        } catch (e) {
          process.stderr.write(`MCP server "${serverCfg.name}" failed: ${e}\n`);
        }
      }
      // Register MCP tools as wrapper tools
      for (const def of mcp.getAllToolDefinitions()) {
        const mcpName = def.function.name;
        const parsed = mcp.findServerForTool(mcpName);
        if (!parsed) continue;
        registry.register({
          name: mcpName,
          description: def.function.description,
          parameters: def.function.parameters as Record<string, unknown>,
          execute: async (args) => mcp.callTool(parsed.serverName, parsed.toolName, args),
        });
      }
    })();
  }, [config.mcp.servers]);

  // Load and activate plugins
  useEffect(() => {
    const pm = new PluginManager(toolRegistry.current);
    pm.discoverAndActivate(process.cwd(), configRef.current).catch(() => {});
    pluginManager.current = pm;
    return () => { pm.deactivateAll().catch(() => {}); };
  }, []);

  // Handle setup completion
  const handleSetupComplete = useCallback((newConfig: Config) => {
    setConfig(newConfig);
    setMode(newConfig.agent.mode);
    setOverlay('none');
    saveConfig(newConfig);
    sessionManager.current.createSession('New Session', newConfig.provider.model, newConfig.agent.mode);
  }, []);

  // Handle slash commands
  const handleSlashCommand = useCallback((text: string) => {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    switch (cmd) {
      case 'new':
        sessionManager.current.createSession('New Session', configRef.current.provider.model, modeRef.current);
        setMessages([]);
        setUsage({ ...EMPTY_USAGE });
        break;

      case 'fork': {
        const newName = cmdArgs.join(' ') || `Fork - ${new Date().toLocaleString()}`;
        const currentId = sessionManager.current.current?.id;
        if (currentId) {
          const forked = sessionManager.current.forkSession(currentId, newName);
          if (forked) {
            setMessages([...forked.messages, { role: 'assistant', content: `🔀 已分支会话: **${newName}**` }]);
            setUsage(forked.token_usage);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '❌ 分支失败' }]);
          }
        }
        break;
      }

      case 'mode':
        if (cmdArgs[0] && ['plan', 'agent', 'yolo'].includes(cmdArgs[0])) {
          setMode(cmdArgs[0] as AgentMode);
          setConfig(prev => {
            const updated = { ...prev, agent: { ...prev.agent, mode: cmdArgs[0] as AgentMode } };
            saveConfig(updated);
            return updated;
          });
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🔄 已切换到 **${cmdArgs[0]}** 模式`,
          }]);
        }
        break;

      case 'save':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '💾 会话已自动保存',
        }]);
        break;

      case 'list': {
        const allSessions = sessionManager.current.listSessions(20);
        if (allSessions.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '📭 暂无历史会话' }]);
        } else {
          const lines = allSessions.map((s, i) => {
            const date = new Date(s.updated_at).toLocaleString();
            const current = s.id === sessionManager.current.current?.id ? ' ← 当前' : '';
            return `${i + 1}. **${s.name}** [${s.model}] ${date}${current}`;
          }).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `📂 **会话列表** (${allSessions.length} 个)\n${lines}\n\n用 \`Ctrl+R\` 切换会话` }]);
        }
        break;
      }

      case 'model':
        if (cmdArgs[0]) {
          setConfig(prev => {
            const updated = { ...prev, provider: { ...prev.provider, model: cmdArgs[0] } };
            saveConfig(updated);
            return updated;
          });
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🔄 已切换模型为 **${cmdArgs[0]}**`,
          }]);
        }
        break;

      case 'clear':
        setMessages([]);
        break;

      case 'compact': {
        const client = createProvider(configRef.current.provider.providerType, configRef.current.provider.apiKey, configRef.current.provider.baseUrl, configRef.current.provider.model);
        setMessages(prev => [...prev, { role: 'assistant', content: '⏳ 正在压缩上下文...' }]);
        compactContext(messagesRef.current, client, (msg) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: `⏳ ${msg}` };
            return updated;
          });
        }).then(({ compacted, savedTokens }) => {
          const statusMsg = savedTokens > 0
            ? `✅ 上下文已压缩，节省约 ${savedTokens} tokens`
            : '✅ 上下文无需压缩';
          setMessages([...compacted, { role: 'assistant', content: statusMsg }]);
        }).catch(() => {
          setMessages(prev => [...prev, { role: 'assistant', content: '❌ 上下文压缩失败' }]);
        });
        break;
      }

      case 'help':
        setOverlay('help');
        break;

      // ===== 新增命令 =====

      case 'retry':
        // 重试上一条用户消息：移除最后一个 user 消息之后的所有内容，重新提交
        {
          const msgs = messagesRef.current;
          let lastUserIdx = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user') { lastUserIdx = i; break; }
          }
          if (lastUserIdx >= 0) {
            const userContent = msgs[lastUserIdx].content || '';
            setMessages(msgs.slice(0, lastUserIdx));
            setTimeout(() => handleSubmit(userContent), 100);
          }
        }
        break;

      case 'undo':
        // 撤销到上一轮：找到倒数第二个 user 消息，截断到那里
        {
          const msgs = messagesRef.current;
          let lastUserIdx = -1;
          let secondLastUserIdx = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user') {
              if (lastUserIdx === -1) lastUserIdx = i;
              else { secondLastUserIdx = i; break; }
            }
          }
          if (secondLastUserIdx >= 0) {
            setMessages([...msgs.slice(0, secondLastUserIdx), { role: 'assistant', content: '↩️ 已撤销到上一轮' }]);
          } else if (lastUserIdx >= 0) {
            // 只有一条 user 消息，清空所有
            setMessages([{ role: 'assistant', content: '↩️ 已清空所有对话' }]);
          }
        }
        break;

      case 'export': {
        try {
          const filePath = exportConversation(messagesRef.current, cmdArgs[0]);
          setMessages(prev => [...prev, { role: 'assistant', content: `✅ 对话已导出到: \`${filePath}\`` }]);
        } catch (e) {
          setMessages(prev => [...prev, { role: 'assistant', content: `❌ 导出失败: ${e instanceof Error ? e.message : String(e)}` }]);
        }
        break;
      }

      case 'git': {
        const sub = cmdArgs[0] || 'status';
        if (sub === 'status') {
          getGitInfo().then(info => {
            const msg = [
              `🔀 **Git 状态**`,
              `分支: \`${info.branch}\``,
              `状态: ${info.status}`,
              info.lastCommit ? `最新提交: ${info.lastCommit}` : '',
            ].filter(Boolean).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
          });
        } else if (sub === 'diff') {
          getGitDiff().then(diff => {
            setMessages(prev => [...prev, { role: 'assistant', content: `📝 **Git Diff**\n\`\`\`\n${diff}\n\`\`\`` }]);
          });
        } else if (sub === 'log') {
          const n = parseInt(cmdArgs[1]) || 5;
          getRecentCommits(n).then(log => {
            setMessages(prev => [...prev, { role: 'assistant', content: `📜 **最近 ${n} 次提交**\n${log}` }]);
          });
        } else if (sub === 'commit') {
          // 自动生成 commit message 并提交
          getGitDiff().then(diff => {
            if (!diff || diff.trim() === '') {
              setMessages(prev => [...prev, { role: 'assistant', content: '📭 没有需要提交的变更' }]);
              return;
            }
            const customMsg = cmdArgs.slice(1).join(' ');
            if (customMsg) {
              // 用户指定了 commit message，直接提交
              handleSubmit(`请用 shell 执行: git add -A && git commit -m "${customMsg}"`);
            } else {
              // 让 MiMo 根据 diff 生成 commit message
              handleSubmit(`请根据以下 git diff 生成一个简洁的中文 commit message（遵循 conventional commits 格式），然后执行 git add -A && git commit:\n\n\`\`\`\n${diff.slice(0, 3000)}\n\`\`\``);
            }
          });
        } else if (sub === 'stash' && cmdArgs[1]) {
          const stashSub = cmdArgs[1];
          if (stashSub === 'list') {
            handleSubmit('请用 shell 执行 git stash list 并展示所有 stash');
          } else if (stashSub === 'apply') {
            const n = cmdArgs[2] || '0';
            handleSubmit(`请用 shell 执行 git stash apply stash@{${n}} 并报告结果`);
          } else if (stashSub === 'drop') {
            const n = cmdArgs[2] || '0';
            handleSubmit(`请用 shell 执行 git stash drop stash@{${n}} 并报告结果`);
          }
        } else if (sub === 'stash') {
          handleSubmit('请用 shell 执行 git stash 并告诉我结果');
        } else if (sub === 'branch') {
          handleSubmit('请用 shell 执行 git branch -a 并列出所有分支');
        } else if (sub === 'pr') {
          const prSub = cmdArgs[1];
          if (prSub === 'list') {
            setMessages(prev => [...prev, { role: 'assistant', content: '📋 正在列出开放的 PR...' }]);
            handleSubmit('请用 shell 执行 gh pr list --limit 10 并展示结果');
          } else if (prSub === 'view') {
            const prNumber = cmdArgs[2];
            if (!prNumber) {
              handleSubmit('请用 shell 执行 gh pr view 并展示当前 PR 详情');
            } else {
              handleSubmit(`请用 shell 执行 gh pr view ${prNumber} 并展示结果`);
            }
          } else if (prSub === 'merge') {
            const prNumber = cmdArgs[2];
            if (!prNumber) {
              setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git pr merge [PR 编号]' }]);
            } else {
              setMessages(prev => [...prev, { role: 'assistant', content: `🔀 正在合并 PR #${prNumber} (squash)...` }]);
              handleSubmit(`请用 shell 执行 gh pr merge ${prNumber} --squash 并报告结果`);
            }
          } else {
            // Default: Generate PR description
            setMessages(prev => [...prev, { role: 'assistant', content: '🔍 正在分析分支差异...' }]);
            Promise.all([
              new Promise<string>((resolve) => {
                const { execSync: execSyncPr } = require('child_process');
                try { resolve(execSyncPr('git diff main...HEAD --stat', { encoding: 'utf-8', timeout: 10000 })); } catch { resolve(''); }
              }),
              new Promise<string>((resolve) => {
                const { execSync: execSyncDiff } = require('child_process');
                try { resolve(execSyncDiff('git diff main...HEAD', { encoding: 'utf-8', timeout: 15000 }).slice(0, 6000)); } catch { resolve(''); }
              }),
            ]).then(([stat, diff]) => {
              if (!stat && !diff) {
                setMessages(prev => [...prev, { role: 'assistant', content: '📭 没有发现与 main 分支的差异' }]);
                return;
              }
              handleSubmit(
                `请根据以下 Git 分支差异生成一个 PR 标题和描述，包含以下部分：\n` +
                `1. **变更摘要** - 简要说明本次变更的目的和内容\n` +
                `2. **修改文件列表** - 列出主要修改的文件\n` +
                `3. **测试说明** - 建议如何测试这些变更\n` +
                `4. **破坏性变更** - 如果有破坏性变更请列出，没有则说明无\n\n` +
                `## 变更统计:\n\`\`\`\n${stat}\n\`\`\`\n\n` +
                `## 完整差异:\n\`\`\`\n${diff}\n\`\`\``
              );
            });
          }
        } else if (sub === 'blame') {
          const blameFile = cmdArgs.slice(1).join(' ');
          if (!blameFile) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git blame <文件路径>' }]);
          } else {
            handleSubmit(`请用 shell 执行 git blame "${blameFile}" 并展示结果`);
          }
        } else if (sub === 'conflict') {
          // Find conflicted files, submit to MiMo for resolution help
          handleSubmit(
            '请用 shell 执行 git diff --name-only --diff-filter=U 查找所有有合并冲突的文件，' +
            '然后读取每个冲突文件的内容，分析冲突标记（<<<<<<< / ======= / >>>>>>>），' +
            '并为每个文件提供解决冲突的建议。如果有 <<<<<<< 标记的文件，请给出推荐的解决方案。'
          );
        } else if (sub === 'compare') {
          const compareBranch = cmdArgs[1];
          if (!compareBranch) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git compare <分支名>' }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `🔀 正在与 ${compareBranch} 分支对比...` }]);
            new Promise<string>((resolve) => {
              const { execSync: execSyncCmp } = require('child_process');
              try { resolve(execSyncCmp(`git diff ${compareBranch}...HEAD --stat`, { encoding: 'utf-8', timeout: 10000 })); } catch { resolve(''); }
            }).then(stat => {
              if (!stat || stat.trim() === '') {
                setMessages(prev => [...prev, { role: 'assistant', content: `✅ 当前分支与 ${compareBranch} 没有差异` }]);
              } else {
                setMessages(prev => [...prev, { role: 'assistant', content: `🔀 **与 ${compareBranch} 的差异**\n\`\`\`\n${stat}\n\`\`\`` }]);
              }
            });
          }
        } else if (sub === 'amend') {
          handleSubmit(
            '请查看 git diff --staged 的内容和最近一次 commit（git log -1 --format="%s%n%n%b"），' +
            '如果暂存区有变更则执行 git commit --amend --no-edit，' +
            '如果没有暂存区变更则提示用户先暂存文件。用中文回复。'
          );
        } else if (sub === 'tag') {
          const tagName = cmdArgs[1];
          if (!tagName) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git tag <标签名>  (如: v1.0.0)' }]);
          } else {
            handleSubmit(`请用 shell 依次执行以下命令：\n1. git tag ${tagName}\n2. git push origin ${tagName}\n\n然后报告结果`);
          }
        } else if (sub === 'clean') {
          // Dry-run first to show what would be deleted, then ask for confirmation
          handleSubmit(
            '请先用 shell 执行 git clean -fd --dry-run 展示哪些未跟踪文件会被删除，' +
            '然后询问用户是否确认执行。如果用户确认，再执行 git clean -fd 删除这些文件。用中文回复。'
          );
        } else if (sub === 'bisect') {
          const goodCommit = cmdArgs[1];
          const badCommit = cmdArgs[2];
          if (!goodCommit || !badCommit) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git bisect <good_commit> <bad_commit>' }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '🔍 正在启动 git bisect 自动排查...' }]);
            handleSubmit(
              '请用 shell 工具执行 git bisect 流程: ' +
              '1) git bisect start 2) git bisect bad ' + badCommit +
              ' 3) git bisect good ' + goodCommit +
              ' 4) 在每个 bisect 步骤运行测试，根据结果执行 git bisect good 或 git bisect bad' +
              ' 5) 找到引入 bug 的 commit 后执行 git bisect reset。用中文回复。'
            );
          }
        } else if (sub === 'cherry-pick') {
          const commit = cmdArgs[1];
          if (!commit) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git cherry-pick <commit>' }]);
          } else {
            handleSubmit('请用 shell 执行 git cherry-pick ' + commit + '，如果有冲突则帮助解决。用中文回复。');
          }
        } else if (sub === 'rebase') {
          const rebaseBranch = cmdArgs[1];
          if (!rebaseBranch) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git rebase <branch>' }]);
          } else {
            handleSubmit('请用 shell 执行 git rebase ' + rebaseBranch + '，如果有冲突则帮助解决。用中文回复。');
          }
        } else if (sub === 'hook') {
          const hookType = cmdArgs[1];
          if (hookType === 'pre-commit') {
            handleSubmit(
              '请创建 .git/hooks/pre-commit 文件，内容为运行 lint 和 typecheck 的脚本。如果任一失败则阻止提交。用中文回复。'
            );
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git hook pre-commit' }]);
          }
        } else if (sub === 'undo') {
          // Undo last git operation: run git reset --soft HEAD~1
          setMessages(prev => [...prev, { role: 'assistant', content: '⏪ 正在撤销上一次提交...' }]);
          handleSubmit(
            '请先用 shell 执行 git reflog -5 展示最近 5 次 git 操作，然后执行 git reset --soft HEAD~1 撤销最近一次提交（保留更改在暂存区）。用中文回复结果。'
          );
        } else if (sub === 'sync') {
          setMessages(prev => [...prev, { role: 'assistant', content: '🔄 正在同步远程仓库...' }]);
          handleSubmit(
            '请用 shell 依次执行: git fetch --all && git pull --rebase && git push。如果有冲突则帮助解决。用中文回复结果。'
          );
        } else if (sub === 'graph') {
          handleSubmit('请用 shell 执行 git log --oneline --graph --all -20 并展示结果');
        } else if (sub === 'worktree') {
          const wtSub = cmdArgs[1] || 'list';
          if (wtSub === 'list') {
            handleSubmit('请用 shell 执行 git worktree list 并展示所有工作树');
          } else if (wtSub === 'add') {
            const branch = cmdArgs[2];
            if (!branch) {
              setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git worktree add <branch>' }]);
            } else {
              setMessages(prev => [...prev, { role: 'assistant', content: `🌳 正在创建工作树: ${branch}...` }]);
              handleSubmit(`请用 shell 执行 git worktree add .worktrees/${branch} ${branch}，然后报告结果。用中文回复。`);
            }
          } else if (wtSub === 'remove') {
            const wtName = cmdArgs[2];
            if (!wtName) {
              setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git worktree remove <name>' }]);
            } else {
              handleSubmit(`请用 shell 执行 git worktree remove .worktrees/${wtName}，然后报告结果。用中文回复。`);
            }
          } else {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❓ 用法: /git worktree <list|add|remove> [参数]\n\n  /git worktree list          - 列出所有工作树\n  /git worktree add <branch>  - 创建新工作树\n  /git worktree remove <name> - 移除工作树',
            }]);
          }
        } else if (sub === 'search') {
          const query = cmdArgs.slice(1).join(' ');
          if (!query) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git search <搜索词>' }]);
          } else {
            handleSubmit(`请用 shell 执行 git log --all --oneline --grep="${query}" -20 并展示结果`);
          }
        } else if (sub === 'recent') {
          handleSubmit('请用 shell 执行 git log --diff-filter=M --name-only --pretty=format: -10 | sort -u 并展示最近修改的文件');
        } else if (sub === 'contributors') {
          handleSubmit('请用 shell 执行 git shortlog -sn --all 并展示贡献者列表');
        } else if (sub === 'release') {
          const version = cmdArgs[1];
          if (!version) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git release <version>  (如: v1.0.0)' }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `🏷️ 正在创建发布版本: ${version}...` }]);
            handleSubmit(
              `请执行: 1) git log --oneline (最近的 commits) 2) 根据 commits 生成 CHANGELOG 3) git tag ${version} 4) git push origin ${version}`
            );
          }
        } else if (sub === 'wip') {
          setMessages(prev => [...prev, { role: 'assistant', content: '🚧 正在创建 WIP 提交...' }]);
          handleSubmit('请用 shell 执行 git add -A && git commit -m "WIP: work in progress"，然后报告结果');
        } else if (sub === 'issue') {
          const issueTitle = cmdArgs.slice(1).join(' ');
          if (!issueTitle) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git issue <标题>' }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `📝 正在创建 GitHub Issue: ${issueTitle}...` }]);
            handleSubmit(`请用 shell 执行: gh issue create --title '${issueTitle}' --body '(由 MiMo TUI 自动创建)'`);
          }
        } else if (sub === 'ci') {
          const ciSub = cmdArgs[1];
          if (ciSub === 'logs') {
            setMessages(prev => [...prev, { role: 'assistant', content: '📋 正在获取最新 CI 日志...' }]);
            handleSubmit('请用 shell 执行 gh run view --log 并展示结果');
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '🔄 正在检查 CI 状态...' }]);
            handleSubmit('请用 shell 执行 gh run list --limit 5 并展示结果');
          }
        } else if (sub === 'stats') {
          setMessages(prev => [...prev, { role: 'assistant', content: '📊 正在统计 Git 数据...' }]);
          Promise.all([
            new Promise<string>((resolve) => {
              const { execSync: execSyncStats } = require('child_process');
              try {
                resolve(execSyncStats(
                  'git log --shortstat --since="1 month ago" | grep "files changed" | awk \'{files+=$1; ins+=$4; del+=$6} END {print "月度统计: 修改 "files" 文件, 新增 "ins" 行, 删除 "del" 行"}\'',
                  { encoding: 'utf-8', timeout: 15000, shell: 'bash' }
                ).trim());
              } catch { resolve(''); }
            }),
            new Promise<string>((resolve) => {
              const { execSync: execSyncAuthors } = require('child_process');
              try {
                resolve(execSyncAuthors(
                  'git shortlog -sn --since="1 month ago"',
                  { encoding: 'utf-8', timeout: 10000 }
                ).trim());
              } catch { resolve(''); }
            }),
          ]).then(([monthlyStats, authorStats]) => {
            const msg = [
              `📊 **Git 月度统计**`,
              ``,
              monthlyStats || '暂无月度数据',
              ``,
              `**本月活跃贡献者**`,
              authorStats || '暂无贡献者数据',
            ].join('\n');
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: msg };
              return updated;
            });
          });
        } else if (sub === 'authors') {
          handleSubmit('请用 shell 执行 git shortlog -sn --all 并展示所有作者及提交次数');
        } else if (sub === 'churn') {
          setMessages(prev => [...prev, { role: 'assistant', content: '🔄 正在分析文件变更频率...' }]);
          handleSubmit('请用 shell 执行 git log --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20 并展示结果');
        } else if (sub === 'timeline') {
          const timelineFile = cmdArgs.slice(1).join(' ');
          if (!timelineFile) {
            setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git timeline <文件路径>' }]);
          } else {
            handleSubmit(`请用 shell 执行 git log --oneline --follow -20 -- "${timelineFile}" 并展示结果`);
          }
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: [
              '❓ 未知的 git 子命令。可用命令:',
              '  /git status   - 查看 Git 状态',
              '  /git diff     - 查看工作区差异',
              '  /git log [n]  - 查看最近 n 次提交',
              '  /git commit   - 智能提交',
              '  /git stash    - 暂存工作区',
              '  /git branch   - 查看所有分支',
              '  /git pr       - 生成 PR 描述',
              '  /git pr list  - 列出开放的 PR',
              '  /git pr view [n] - 查看 PR 详情',
              '  /git pr merge [n] - 合并 PR (squash)',
              '  /git issue <title> - 创建 GitHub Issue',
              '  /git ci       - 查看 CI 状态',
              '  /git ci logs  - 查看最新 CI 日志',
              '  /git blame <file> - 查看文件修改历史',
              '  /git conflict - 帮助解决合并冲突',
              '  /git compare <branch> - 对比分支差异',
              '  /git amend    - 修改最近一次提交',
              '  /git tag <name> - 创建并推送标签',
              '  /git clean    - 清理未跟踪文件',
              '  /git bisect <good> <bad> - 自动排查 bug',
              '  /git cherry-pick <commit> - 摘取提交',
              '  /git rebase <branch> - 变基',
              '  /git hook pre-commit - 设置 pre-commit 钩子',
              '  /git undo     - 撤销上一次提交',
              '  /git sync     - 同步远程仓库',
              '  /git graph    - 可视化提交图',
              '  /git worktree <list|add|remove> - 工作树管理',
              '  /git stash <list|apply|drop> - Stash 管理',
              '  /git search <query> - 搜索提交信息',
              '  /git recent   - 最近修改的文件',
              '  /git contributors - 贡献者列表',
              '  /git release <version> - 创建发布版本',
              '  /git wip      - 快速 WIP 提交',
              '  /git stats    - 月度 Git 统计',
              '  /git authors  - 所有作者及提交次数',
              '  /git churn    - 文件变更频率排名',
              '  /git timeline <file> - 文件提交时间线',
            ].join('\n'),
          }]);
        }
        break;
      }

      case 'tree': {
        const tree = generateFileTree(process.cwd());
        const text = formatFileTree(tree);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🌳 **项目文件树**\n\`\`\`\n${text}\n\`\`\``,
        }]);
        break;
      }

      case 'project': {
        const info = detectProject();
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📋 **项目信息**\n${formatProjectSummary(info)}`,
        }]);
        break;
      }

      case 'cost':
      case 'usage': {
        const u = usage;
        const sessionCost = calculateCost(configRef.current.provider.model, u.promptTokens, u.completionTokens, u.cacheHitTokens);
        const summary = getCostSummary();
        const msg = [
          `💰 **费用统计**`,
          ``,
          `**本次会话**`,
          `  总 Token: ${u.totalTokens.toLocaleString()}`,
          `  输入: ${u.promptTokens.toLocaleString()} | 输出: ${u.completionTokens.toLocaleString()}`,
          `  缓存命中: ${u.cacheHitTokens.toLocaleString()} | 未命中: ${u.cacheMissTokens.toLocaleString()}`,
          `  费用: $${sessionCost.toFixed(4)}`,
          ``,
          `**累计统计** (${summary.recordCount} 次调用)`,
          `  今日: $${summary.today.toFixed(4)}`,
          `  本周: $${summary.thisWeek.toFixed(4)}`,
          `  本月: $${summary.thisMonth.toFixed(4)}`,
          `  总计: $${summary.total.toFixed(4)}`,
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      case 'theme': {
        const themeName = cmdArgs[0];
        if (themeName && ['default', 'whale', 'matrix', 'dracula', 'solarized'].includes(themeName)) {
          setConfig(prev => {
            const updated = { ...prev, ui: { ...prev.ui, theme: themeName } };
            saveConfig(updated);
            return updated;
          });
          setMessages(prev => [...prev, { role: 'assistant', content: `🎨 主题已切换为: **${themeName}**` }]);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🎨 **可用主题**\n- \`default\` (默认暗色)\n- \`whale\` (深海蓝)\n- \`matrix\` (黑客帝国)\n- \`dracula\` (德古拉)\n- \`solarized\` (日光)\n\n用法: \`/theme <名称>\``,
          }]);
        }
        break;
      }

      case 'debug': {
        if (cmdArgs[0] === 'agents') {
          const sam = subAgentManager.current;
          const allTasks = sam.getAllTasks();
          const wf = activeWorkflow.current;
          const agentInfo = [
            `🤖 **智能体能力状态**`,
            ``,
            `**子代理管理器**`,
            `  运行中: ${sam.runningCount}`,
            `  排队中: ${sam.pendingCount}`,
            `  已生成: ${allTasks.length}`,
            ``,
            `**文件监控**: ${fileWatcher.current.isWatching ? '运行中' : '未启用'}`,
            `**自动提交**: ${autoCommit.current ? '开启' : '关闭'}`,
            `**自动测试**: ${autoTest.current ? '开启' : '关闭'}`,
            ``,
            `**活跃工作流**: ${wf ? `${wf.workflow.name} (步骤 ${wf.stepIndex + 1}/${wf.workflow.steps.length})` : '无'}`,
          ].join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: agentInfo }]);
          break;
        }
        const toolNames = toolRegistry.current.allToolNames;
        const debugInfo = [
          `🐛 **调试信息**`,
          `Node: ${process.version}`,
          `平台: ${process.platform} ${process.arch}`,
          `工作目录: ${process.cwd()}`,
          `模型: ${configRef.current.provider.model}`,
          `API: ${configRef.current.provider.baseUrl}`,
          `模式: ${modeRef.current}`,
          `消息数: ${messagesRef.current.length}`,
          `内存: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          ``,
          `**已注册工具** (${toolNames.length} 个)`,
          `  ${toolNames.join(', ')}`,
          ``,
          `**子命令**: \`/debug agents\` 查看智能体能力状态`,
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: debugInfo }]);
        break;
      }

      case 'cd': {
        const target = cmdArgs.join(' ');
        if (!target) {
          setMessages(prev => [...prev, { role: 'assistant', content: `📁 当前目录: \`${process.cwd()}\`\n用法: \`/cd <路径>\`` }]);
          break;
        }
        try {
          const resolved = path.resolve(process.cwd(), target);
          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ 目录不存在: ${target}` }]);
            break;
          }
          process.chdir(resolved);
          sandbox.current = new Sandbox(resolved);
          setMessages(prev => [...prev, { role: 'assistant', content: `📁 已切换到: \`${resolved}\`` }]);
        } catch (e) {
          setMessages(prev => [...prev, { role: 'assistant', content: `❌ 切换目录失败: ${e instanceof Error ? e.message : String(e)}` }]);
        }
        break;
      }

      case 'think': {
        const level = cmdArgs[0];
        if (level && ['low', 'medium', 'high', 'auto'].includes(level)) {
          setConfig(prev => {
            const updated = { ...prev, agent: { ...prev.agent, reasoningEffort: level as 'low' | 'medium' | 'high' } };
            saveConfig(updated);
            return updated;
          });
          const labels: Record<string, string> = { low: '快速 (5K tokens)', medium: '平衡 (10K tokens)', high: '深度 (20K tokens)', auto: '自动 (根据任务调整)' };
          setMessages(prev => [...prev, { role: 'assistant', content: `🧠 推理深度: **${labels[level]}**` }]);
        } else {
          const current = configRef.current.agent.reasoningEffort;
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🧠 **推理深度设置**\n\n当前: **${current}**\n\n- \`low\` 快速推理 (5K tokens) - 简单问答\n- \`medium\` 平衡 (10K tokens) - 日常开发\n- \`high\` 深度推理 (20K tokens) - 复杂调试\n- \`auto\` 自动调整\n\n用法: \`/think <级别>\``,
          }]);
        }
        break;
      }

      case 'health': {
        const cfg = configRef.current;
        setMessages(prev => [...prev, { role: 'assistant', content: '🏥 正在检查 API 连接...' }]);
        checkApiHealth(cfg.provider.baseUrl, cfg.provider.apiKey, cfg.provider.model).then(result => {
          const msg = result.ok
            ? `✅ API 连接正常\n延迟: ${result.latencyMs}ms\n模型: ${result.model}`
            : `❌ API 连接失败\n错误: ${result.error}\n延迟: ${result.latencyMs}ms`;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: msg };
            return updated;
          });
        });
        break;
      }

      case 'doctor': {
        setMessages(prev => [...prev, { role: 'assistant', content: '🏥 正在诊断...' }]);
        const cfg = configRef.current;
        const checks: string[] = [];

        // 1. 配置检查
        checks.push(`**配置**`);
        checks.push(`  API 密钥: ${cfg.provider.apiKey ? `✅ 已设置 (${cfg.provider.apiKey.slice(0, 8)}...)` : '❌ 未设置'}`);
        checks.push(`  API 地址: ${cfg.provider.baseUrl}`);
        checks.push(`  模型: ${cfg.provider.model}`);
        checks.push(`  模式: ${cfg.agent.mode}`);
        checks.push(`  推理深度: ${cfg.agent.reasoningEffort}`);

        // 2. 工具注册检查
        const toolNames = toolRegistry.current.allToolNames;
        const expectedTools = ['read_file', 'write_file', 'edit_file', 'shell', 'glob', 'grep', 'web_fetch', 'todo', 'codebase', 'test_runner', 'multi_edit'];
        const missingTools = expectedTools.filter(t => !toolNames.includes(t));
        checks.push(`\n**工具** (${toolNames.length} 个)`);
        checks.push(`  ${missingTools.length === 0 ? '✅ 全部就绪' : `❌ 缺少: ${missingTools.join(', ')}`}`);

        // 3. 会话检查
        const sessionCount = sessionManager.current.listSessions(100).length;
        const currentSession = sessionManager.current.current;
        checks.push(`\n**会话**`);
        checks.push(`  当前: ${currentSession ? `✅ ${currentSession.name}` : '❌ 无'}`);
        checks.push(`  历史: ${sessionCount} 个`);

        // 4. 缓存检查
        const u = usage;
        const cacheTotal = u.cacheHitTokens + u.cacheMissTokens;
        const cacheRate = cacheTotal > 0 ? Math.round((u.cacheHitTokens / cacheTotal) * 100) : 0;
        checks.push(`\n**缓存**`);
        checks.push(`  命中率: ${cacheRate}% ${cacheRate >= 60 ? '✅' : cacheRate >= 30 ? '⚠️' : '❌ (首轮正常)'}`);

        // 5. 运行环境
        checks.push(`\n**环境**`);
        checks.push(`  Node: ${process.version}`);
        checks.push(`  平台: ${process.platform} ${process.arch}`);
        checks.push(`  工作目录: ${process.cwd()}`);
        checks.push(`  内存: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

        // 6. API 连接测试
        checkApiHealth(cfg.provider.baseUrl, cfg.provider.apiKey, cfg.provider.model).then(result => {
          checks.push(`\n**API 连接**`);
          if (result.ok) {
            checks.push(`  ✅ 连接正常`);
            checks.push(`  延迟: ${result.latencyMs}ms`);
            if (result.usage) {
              const r = result.usage;
              checks.push(`  缓存: 命中 ${r.cacheHitTokens} | 未命中 ${r.cacheMissTokens}`);
            }
          } else {
            checks.push(`  ❌ 连接失败: ${result.error}`);
            // 恢复建议
            if (result.error?.includes('401') || result.error?.includes('Unauthorized')) {
              checks.push(`  💡 API 密钥无效，请运行 \`/config\` 检查或重新 \`--setup\``);
            } else if (result.error?.includes('404')) {
              checks.push(`  💡 API 端点不存在，检查 base_url 是否正确`);
            } else if (result.error?.includes('timeout') || result.error?.includes('ECONNREFUSED')) {
              checks.push(`  💡 网络连接失败，检查网络或 API 地址`);
            }
          }

          const summary = checks.join('\n');
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: `🏥 **诊断报告**\n\n${summary}` };
            return updated;
          });
        });
        break;
      }

      case 'fix': {
        const hasFile = (f: string) => { try { return fs.existsSync(path.join(process.cwd(), f)); } catch { return false; } };
        const hasScript = (name: string) => {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
            return !!(pkg.scripts?.[name]);
          } catch { return false; }
        };

        const fixes: Array<{ name: string; cmd: string }> = [];

        if (hasScript('lint')) fixes.push({ name: 'Lint', cmd: 'npm run lint -- --fix 2>&1 || true' });
        else if (hasFile('.eslintrc.js') || hasFile('.eslintrc.json') || hasFile('eslint.config.js')) fixes.push({ name: 'Lint', cmd: 'npx eslint . --fix 2>&1 || true' });

        if (hasScript('format')) fixes.push({ name: 'Format', cmd: 'npm run format 2>&1 || true' });
        else if (hasFile('.prettierrc') || hasFile('.prettierrc.json')) fixes.push({ name: 'Format', cmd: 'npx prettier --write . 2>&1 || true' });

        if (hasFile('tsconfig.json')) fixes.push({ name: 'TypeCheck', cmd: 'npx tsc --noEmit 2>&1' });

        if (fixes.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '🔧 未检测到可修复工具 (eslint/prettier/tsc)\n用法: `/fix` 自动检测并执行' }]);
        } else {
          const summary = fixes.map(f => `  ${f.name}: \`${f.cmd}\``).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `🔧 执行 ${fixes.length} 项修复:\n${summary}\n\n正在执行...` }]);
          // 依次执行所有修复命令
          handleSubmit(`请用 shell 工具依次执行以下命令并报告结果:\n${fixes.map(f => f.cmd).join('\n')}`);
        }
        break;
      }

      case 'history': {
        const n = parseInt(cmdArgs[0]) || 10;
        const history = commandHistory.current.getAll().slice(-n);
        if (history.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '📜 暂无命令历史' }]);
        } else {
          const list = history.map((h, i) => `${i + 1}. ${h}`).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `📜 **最近 ${history.length} 条记录**\n${list}` }]);
        }
        break;
      }

      case 'search': {
        const query = cmdArgs.join(' ');
        if (!query) {
          setMessages(prev => [...prev, { role: 'assistant', content: '🔍 用法: `/search <关键词>`' }]);
          break;
        }
        const results = messagesRef.current
          .filter(m => m.content && m.content.toLowerCase().includes(query.toLowerCase()))
          .slice(-5);
        if (results.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: `🔍 未找到包含 "${query}" 的消息` }]);
        } else {
          const list = results.map((m, i) => {
            const preview = m.content!.slice(0, 100).replace(/\n/g, ' ');
            return `${i + 1}. [${m.role === 'user' ? '你' : 'MiMo'}] ${preview}...`;
          }).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `🔍 **搜索 "${query}"** 找到 ${results.length} 条:\n${list}` }]);
        }
        break;
      }

      case 'rename': {
        const newName = cmdArgs.join(' ');
        if (newName) {
          sessionManager.current.renameSession(newName);
          setMessages(prev => [...prev, { role: 'assistant', content: `✏️ 会话已重命名为: **${newName}**` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '✏️ 用法: `/rename <新名称>`' }]);
        }
        break;
      }

      case 'tokens': {
        const u = usage;
        const maxTokens = 128000; // MiMo 上下文窗口
        const pct = Math.round((u.totalTokens / maxTokens) * 100);
        const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
        const warning = pct > 80 ? '\n⚠️ **上下文即将用满，建议 /compact 压缩**' : '';
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📊 **上下文用量** ${pct}%\n\`${bar}\` ${u.totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()}${warning}`,
        }]);
        break;
      }

      case 'template':
      case 'tpl': {
        const query = cmdArgs.join(' ');
        if (!query) {
          // 显示所有模板
          const groups = getTemplatesByCategory();
          const lines: string[] = ['📝 **对话模板**\n'];
          for (const [cat, tpls] of groups) {
            lines.push(`**${cat}**`);
            for (const t of tpls) {
              lines.push(`  ${t.icon} \`/tpl ${t.id}\` - ${t.name}: ${t.description}`);
            }
            lines.push('');
          }
          lines.push('用法: `/tpl <id>` 或 `/tpl search <关键词>`');
          setMessages(prev => [...prev, { role: 'assistant', content: lines.join('\n') }]);
        } else if (query.startsWith('search ')) {
          const results = searchTemplates(query.slice(7));
          if (results.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: '🔍 未找到匹配的模板' }]);
          } else {
            const list = results.map(t => `${t.icon} \`${t.id}\` - ${t.name}`).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content: `🔍 找到 ${results.length} 个模板:\n${list}` }]);
          }
        } else {
          const tpl = TEMPLATES.find(t => t.id === query);
          if (tpl) {
            setMessages(prev => [...prev, { role: 'assistant', content: `${tpl.icon} **${tpl.name}**\n\n${tpl.prompt}` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `❓ 模板 "${query}" 不存在。输入 \`/tpl\` 查看所有模板` }]);
          }
        }
        break;
      }

      case 'snippet':
      case 'snip': {
        const sub = cmdArgs[0] || 'list';
        if (sub === 'list') {
          const snippets = snippetLibrary.current.list();
          if (snippets.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: '📎 代码片段库为空。用 `/snip add <名称> <代码>` 添加' }]);
          } else {
            const list = snippets.map(s => `\`${s.id}\` **${s.name}** [${s.language}] ${s.content.slice(0, 40)}...`).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content: `📎 **代码片段** (${snippets.length} 个)\n${list}` }]);
          }
        } else if (sub === 'add') {
          const name = cmdArgs[1];
          const content = cmdArgs.slice(2).join(' ');
          if (name && content) {
            snippetLibrary.current.add(name, content);
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ 已保存片段: **${name}**` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/snip add <名称> <代码>`' }]);
          }
        } else if (sub === 'search') {
          const query = cmdArgs.slice(1).join(' ');
          const results = snippetLibrary.current.search(query);
          if (results.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: `🔍 未找到匹配 "${query}" 的片段` }]);
          } else {
            const list = results.map(s => `\`${s.id}\` **${s.name}**: ${s.content.slice(0, 60)}...`).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content: `🔍 找到 ${results.length} 个片段:\n${list}` }]);
          }
        } else if (sub === 'rm') {
          const id = cmdArgs[1];
          if (id && snippetLibrary.current.remove(id)) {
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ 已删除片段: ${id}` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/snip rm <id>`' }]);
          }
        }
        break;
      }

      case 'config':
      case 'cfg': {
        const cfgSub = cmdArgs[0];
        if (cfgSub === 'edit') {
          handleSubmit('请用 read_file 读取 ~/.mimo/config.toml 的内容，然后展示给用户。告诉用户可以直接修改配置文件。');
          break;
        }
        if (cfgSub === 'reset') {
          saveConfig(DEFAULT_CONFIG);
          setConfig(DEFAULT_CONFIG);
          setMessages(prev => [...prev, { role: 'assistant', content: '⚙️ 配置已重置为默认值' }]);
          break;
        }
        const cfg = configRef.current;
        const msg = [
          `⚙️ **当前配置**`,
          ``,
          `**Provider**`,
          `  模型: ${cfg.provider.model}`,
          `  API: ${cfg.provider.baseUrl}`,
          `  密钥: ${cfg.provider.apiKey.slice(0, 8)}...${cfg.provider.apiKey.slice(-4)}`,
          ``,
          `**Agent**`,
          `  模式: ${cfg.agent.mode}`,
          `  最大迭代: ${cfg.agent.maxIterations}`,
          `  自动批准读取: ${cfg.agent.autoApproveReads ? '是' : '否'}`,
          `  思考: ${cfg.agent.thinkingEnabled ? '开启' : '关闭'}`,
          `  推理深度: ${cfg.agent.reasoningEffort}`,
          ``,
          `**UI**`,
          `  主题: ${cfg.ui.theme}`,
          `  显示思考: ${cfg.ui.showThinking ? '是' : '否'}`,
          `  显示 Token: ${cfg.ui.showTokens ? '是' : '否'}`,
          ``,
          `配置文件: \`~/.mimo/config.toml\``,
          ``,
          `**子命令**: \`/config edit\` 编辑配置 · \`/config reset\` 重置为默认`,
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      case 'bookmark':
      case 'bm': {
        const sub = cmdArgs[0] || 'list';
        if (sub === 'list') {
          const u = usage;
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🔖 **当前会话状态**\n消息数: ${messagesRef.current.length}\nToken: ${u.totalTokens.toLocaleString()}\n模式: ${modeRef.current}\n模型: ${configRef.current.provider.model}`,
          }]);
        }
        break;
      }

      case 'stats': {
        const u = usage;
        const msgCount = messagesRef.current.length;
        const userMsgs = messagesRef.current.filter(m => m.role === 'user').length;
        const assistantMsgs = messagesRef.current.filter(m => m.role === 'assistant').length;
        const toolMsgs = messagesRef.current.filter(m => m.role === 'tool').length;
        const avgResponseLen = assistantMsgs > 0
          ? Math.round(messagesRef.current.filter(m => m.role === 'assistant').reduce((s, m) => s + (m.content?.length || 0), 0) / assistantMsgs)
          : 0;

        const cacheTotal = u.cacheHitTokens + u.cacheMissTokens;
        const cacheRate = cacheTotal > 0 ? Math.round((u.cacheHitTokens / cacheTotal) * 100) : 0;
        const cacheBar = '█'.repeat(Math.round(cacheRate / 5)) + '░'.repeat(20 - Math.round(cacheRate / 5));

        const msg = [
          `📊 **会话统计**`,
          ``,
          `消息: ${msgCount} 条 (用户 ${userMsgs} | 助手 ${assistantMsgs} | 工具 ${toolMsgs})`,
          `平均回复: ${avgResponseLen} 字符`,
          ``,
          `**Token 用量**`,
          `  总计: ${u.totalTokens.toLocaleString()}`,
          `  输入: ${u.promptTokens.toLocaleString()} | 输出: ${u.completionTokens.toLocaleString()}`,
          ``,
          `**缓存命中率**: ${cacheRate}% ${cacheRate >= 60 ? '✅' : cacheRate >= 30 ? '⚠️' : '❌'}`,
          `  \`${cacheBar}\``,
          `  命中: ${u.cacheHitTokens.toLocaleString()} | 未命中: ${u.cacheMissTokens.toLocaleString()}`,
          cacheRate < 30 ? `\n💡 提示: 多轮对话后缓存命中率会自动提升。首轮最低。` : '',
        ].filter(Boolean).join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      case 'context': {
        const msgs = messagesRef.current.filter(m => m.role !== 'system');
        const totalChars = msgs.reduce((s, m) => s + (m.content?.length || 0), 0);
        const toolCallCount = msgs.reduce((s, m) => s + (m.tool_calls?.length || 0), 0);
        const memoryCtx = memoryStore.current.getContextSummary();
        const projectInfo = detectProject();
        const sysLen = systemPrompt.current.length + (memoryCtx?.length || 0);

        const breakdown = msgs.map((m, i) => {
          const len = (m.content?.length || 0);
          const tools = m.tool_calls?.length || 0;
          const label = m.role === 'user' ? '👤' : m.role === 'assistant' ? '🤖' : '🔧';
          const preview = (m.content || '').slice(0, 40).replace(/\n/g, ' ');
          return `  ${label} ${i}: ${len}字符${tools > 0 ? ` +${tools}工具` : ''}  "${preview}..."`;
        }).join('\n');

        const msg = [
          `📋 **上下文详情**`,
          ``,
          `**系统提示词**: ${sysLen} 字符`,
          `  项目: ${projectInfo.name} (${projectInfo.language})`,
          memoryCtx ? `  记忆: ${memoryCtx.length} 字符` : '',
          ``,
          `**对话消息**: ${msgs.length} 条`,
          `  总字符: ${totalChars.toLocaleString()}`,
          `  工具调用: ${toolCallCount} 次`,
          `  预估 Token: ~${Math.round(totalChars * 1.5).toLocaleString()}`,
          ``,
          `**消息明细** (最近 15 条)`,
          breakdown.split('\n').slice(-15).join('\n'),
        ].filter(Boolean).join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      case 'shortcuts':
      case 'keys': {
        const msg = [
          `⌨️ **快捷键速查**`,
          ``,
          `\`Ctrl+K\` 命令面板    \`Ctrl+R\` 会话列表`,
          `\`Ctrl+N\` 新建会话    \`Ctrl+L\` 清屏`,
          `\`Ctrl+Z\` 撤销        \`Ctrl+C\` 取消/退出`,
          `\`Alt+1\` 计划模式     \`Alt+2\` 智能体模式`,
          `\`Alt+3\` 自动模式     \`?\` 帮助`,
          `\`Enter\` 发送         \`Shift+Enter\` 换行`,
          `\`Tab\` 补全命令       \`Esc\` 关闭弹窗`,
          `\`↑/↓\` 历史记录      \`Ctrl+U\` 清空行`,
          `\`Ctrl+A/E\` 行首/行尾`,
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      // ===== 记忆系统 =====
      case 'remember':
      case 'mem': {
        const key = cmdArgs[0];
        const value = cmdArgs.slice(1).join(' ');
        if (key && value) {
          memoryStore.current.remember(key, value, 'preference');
          setMessages(prev => [...prev, { role: 'assistant', content: `🧠 已记住: **${key}** = ${value}` }]);
        } else if (key && !value) {
          const val = memoryStore.current.recall(key);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: val ? `🧠 **${key}**: ${val}` : `❓ 未找到关于 "${key}" 的记忆`,
          }]);
        } else {
          const memories = memoryStore.current.list();
          if (memories.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: '🧠 记忆为空。用 `/mem <键> <值>` 记住信息' }]);
          } else {
            const groups = memoryStore.current.getByCategory();
            const lines: string[] = ['🧠 **记忆库**\n'];
            for (const [cat, mems] of groups) {
              lines.push(`**${cat}**`);
              for (const m of mems) {
                lines.push(`  \`${m.key}\`: ${m.value} (访问 ${m.accessCount} 次)`);
              }
            }
            setMessages(prev => [...prev, { role: 'assistant', content: lines.join('\n') }]);
          }
        }
        break;
      }

      case 'forget': {
        const key = cmdArgs[0];
        if (key && memoryStore.current.forget(key)) {
          setMessages(prev => [...prev, { role: 'assistant', content: `🗑️ 已忘记: ${key}` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/forget <键>`' }]);
        }
        break;
      }

      // ===== 工作流 =====
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
          // Check user-defined workflows first, then built-in
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

      // ===== 终止所有任务 =====
      case 'kill': {
        const stopped: string[] = [];

        // Stop active workflow
        if (activeWorkflow.current) {
          stopped.push(`工作流: ${activeWorkflow.current.workflow.name}`);
          activeWorkflow.current = null;
        }

        // Abort current agent loop
        if (agentLoop.current) {
          agentLoop.current.abort();
          stopped.push('当前 AI 对话');
        }

        // Stop file watcher
        fileWatcher.current.stop();
        stopped.push('文件监控');

        // Reset streaming state
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

      // ===== 清理命令 =====
      case 'clean': {
        const sub = cmdArgs[0];
        if (sub === 'sessions') {
          // Delete old sessions (older than 7 days)
          const sessions = sessionManager.current.listSessions(100);
          const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          let cleaned = 0;
          for (const s of sessions) {
            if (new Date(s.updated_at).getTime() < weekAgo) {
              sessionManager.current.deleteSession(s.id);
              cleaned++;
            }
          }
          setMessages(prev => [...prev, { role: 'assistant', content: `🗑️ 清理了 ${cleaned} 个超过 7 天的会话` }]);
        } else if (sub === 'memory') {
          memoryStore.current.clear();
          setMessages(prev => [...prev, { role: 'assistant', content: '🧠 已清空所有记忆' }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '🗑️ **清理命令**\n\n`/clean sessions` - 清理超过 7 天的旧会话\n`/clean memory` - 清空所有记忆' }]);
        }
        break;
      }

      // ===== 智能建议 =====
      case 'suggest': {
        const suggestions = generateSuggestions();
        if (suggestions.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '✅ 当前没有特别的建议，项目状态良好！' }]);
        } else {
          const lines = suggestions.map(s =>
            `${s.icon} **${s.label}** - ${s.description}\n  命令: \`${s.command}\``
          ).join('\n\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `💡 **智能建议**\n\n${lines}` }]);
        }
        break;
      }

      // ===== 文件变更 =====
      case 'changes':
      case 'watch': {
        const sub = cmdArgs[0];
        if (sub === 'start') {
          fileWatcher.current.watch(process.cwd(), (change) => {
            setFileChanges(fileWatcher.current.getSummary());
          });
          setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 开始监控文件变更...' }]);
        } else if (sub === 'test') {
          // 文件变更时自动跑测试
          fileWatcher.current.watch(process.cwd(), (change) => {
            setFileChanges(fileWatcher.current.getSummary());
            // 防抖：只在停止修改 2 秒后触发
            const timer = setTimeout(() => {
              setMessages(prev => [...prev, { role: 'assistant', content: `🔄 检测到文件变更，自动运行测试...` }]);
              handleSubmit('请用 test_runner 工具运行项目测试，只报告失败的测试。如果全部通过，只说"✅ 测试通过"。');
            }, 2000);
            // 用 ref 存 timer 以便取消
            (fileWatcher as any)._testTimer = timer;
          });
          setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 文件变更自动测试已启动\n修改文件后 2 秒自动运行测试\n`/watch stop` 停止' }]);
        } else if (sub === 'stop') {
          if ((fileWatcher as any)._testTimer) clearTimeout((fileWatcher as any)._testTimer);
          fileWatcher.current.stop();
          setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 已停止文件监控' }]);
        } else {
          const summary = fileWatcher.current.getSummary();
          setMessages(prev => [...prev, { role: 'assistant', content: `👁️ **文件变更**\n${summary}\n\n\`/watch start\` 监控 · \`/watch test\` 自动测试 · \`/watch stop\` 停止` }]);
        }
        break;
      }

      // ===== 命令链 =====
      case 'chain': {
        const commands = cmdArgs.join(' ').split('&&').map(c => c.trim()).filter(Boolean);
        if (commands.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '🔗 用法: `/chain /cmd1 && /cmd2 && /cmd3`\n依次执行多个命令' }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: `🔗 执行命令链 (${commands.length} 步)...` }]);
          commands.forEach((cmd, i) => {
            setTimeout(() => handleSlashCommand(cmd.startsWith('/') ? cmd : `/${cmd}`), i * 200);
          });
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
        // Submit to MiMo with instructions to run each command
        const prompt = `请依次执行以下命令，每条命令用 shell 工具执行，如果某条命令失败则停止并报告错误:\n\n${commands.split('&&').map((c, i) => `${i + 1}. ${c.trim()}`).join('\n')}`;
        setMessages(prev => [...prev, { role: 'assistant', content: `📦 批量执行 ${commands.split('&&').length} 条命令...` }]);
        setTimeout(() => handleSubmit(prompt), 100);
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
        subAgentManager.current.spawn(taskName, taskPrompt, client, toolRegistry.current, toolCtx, modeRef.current, (task) => {
          const status = task.status === 'completed' ? '✅' : '❌';
          const content = task.result || task.error || '无结果';
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `${status} 后台任务 **${taskName}** 已完成\n\n${content.slice(0, 500)}`,
          }]);
        });
        break;
      }

      case 'tips': {
        const u = usage;
        const cacheTotal = u.cacheHitTokens + u.cacheMissTokens;
        const cacheRate = cacheTotal > 0 ? Math.round((u.cacheHitTokens / cacheTotal) * 100) : 0;
        const sessionCost = calculateCost(configRef.current.provider.model, u.promptTokens, u.completionTokens, u.cacheHitTokens);
        const tips: string[] = [];

        if (cacheRate < 30 && cacheTotal > 1000) {
          tips.push('💡 **缓存命中率低** — 多轮对话后会自动提升。首轮最低是正常的。');
        }
        if (u.completionTokens > u.promptTokens * 2) {
          tips.push('💡 **输出 Token 过多** — 试试 `/think low` 降低推理深度，或用更简洁的提问方式。');
        }
        if (configRef.current.provider.model.includes('pro') && sessionCost > 0.1) {
          tips.push('💡 **费用较高** — 简单任务可以用 `/model mimo-v2.5-flash` 切换到 Flash 模型（更便宜）。');
        }
        if (messagesRef.current.length > 50) {
          tips.push('💡 **对话较长** — 试试 `/compact` 压缩上下文，或 `/new` 开始新会话。');
        }
        if (tips.length === 0) {
          tips.push('✅ 当前使用情况良好，没有特别的优化建议。');
        }

        const msg = [
          `💡 **费用优化建议**`,
          ``,
          `当前: ${configRef.current.provider.model} | 费用: $${sessionCost.toFixed(4)} | 缓存: ${cacheRate}%`,
          ``,
          ...tips,
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      // ===== 自动化工作流 =====
      case 'auto': {
        const sub = cmdArgs[0];
        if (sub === 'commit') {
          autoCommit.current = !autoCommit.current;
          setMessages(prev => [...prev, { role: 'assistant', content: autoCommit.current ? '🔄 自动提交已开启 - 每次对话完成后自动 git commit' : '🔄 自动提交已关闭' }]);
        } else if (sub === 'test') {
          autoTest.current = !autoTest.current;
          if (autoTest.current) {
            fileWatcher.current.watch(process.cwd(), () => {
              handleSubmit('请用 test_runner 运行测试，只报告失败项');
            });
            setMessages(prev => [...prev, { role: 'assistant', content: '🧪 自动测试已开启 - 文件变更时自动运行测试' }]);
          } else {
            fileWatcher.current.stop();
            setMessages(prev => [...prev, { role: 'assistant', content: '🧪 自动测试已关闭' }]);
          }
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '🤖 **自动化工作流**\n\n`/auto commit` - 切换自动提交\n`/auto test` - 切换自动测试\n\n当前状态: ' + (autoCommit.current ? '自动提交 ✅' : '自动提交 ❌') + ' | ' + (autoTest.current ? '自动测试 ✅' : '自动测试 ❌') }]);
        }
        break;
      }

      // ===== 多智能体并行任务 =====
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
          subAgentManager.current.spawn(`parallel-${i+1}`, task, client, toolRegistry.current, toolCtx, modeRef.current, (result) => {
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

      // ===== 管道式顺序执行 =====
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

        // Recursive function to run pipeline stages sequentially
        const runStage = (stageIndex: number, previousResult: string) => {
          if (stageIndex >= stages.length) {
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ 管道全部 ${stages.length} 个阶段已完成` }]);
            return;
          }
          const stagePrompt = stageIndex === 0
            ? `请执行以下任务:\n${stages[stageIndex]}`
            : `前一阶段的执行结果:\n${previousResult.slice(0, 2000)}\n\n请基于以上结果，执行以下任务:\n${stages[stageIndex]}`;

          setMessages(prev => [...prev, { role: 'assistant', content: `🔗 正在执行阶段 ${stageIndex + 1}/${stages.length}: ${stages[stageIndex].slice(0, 50)}...` }]);

          subAgentManager.current.spawn(
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
                // Chain next stage with previous result
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
        subAgentManager.current.spawn(`explore-${topic.slice(0, 20)}`, `请用 codebase 和 read_file 工具探索项目，回答以下问题: ${topic}. 只读取和分析，不要修改任何文件。`, client, toolRegistry.current, toolCtx, 'plan', (result) => {
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
        subAgentManager.current.spawn(`review-${target.slice(0, 20)}`, `请审查 ${target} 的代码质量。检查: 1) 潜在的 bug 2) 性能问题 3) 安全隐患 4) 代码风格 5) 可改进建议。给出具体的问题描述和修复建议。`, client, toolRegistry.current, toolCtx, modeRef.current, (result) => {
          const status = result.status === 'completed' ? '✅' : '❌';
          setMessages(prev => [...prev, { role: 'assistant', content: `${status} 代码审查完成: ${target}\n${(result.result || result.error || '').slice(0, 500)}` }]);
        });
        break;
      }

      case 'status': {
        const allTasks = subAgentManager.current.getAllTasks();
        if (allTasks.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '📊 没有后台任务' }]);
          break;
        }
        const lines = allTasks.map(t => {
          const icon = t.status === 'running' ? '🔄' : t.status === 'completed' ? '✅' : '❌';
          return `${icon} ${t.name} [${t.status}]`;
        });
        setMessages(prev => [...prev, { role: 'assistant', content: `📊 **后台任务** (${subAgentManager.current.runningCount} 运行中)\n${lines.join('\n')}` }]);
        break;
      }

      // ===== 会话指标 =====
      case 'metrics': {
        const u = usage;
        const sessionCost = calculateCost(configRef.current.provider.model, u.promptTokens, u.completionTokens, u.cacheHitTokens);
        const cacheTotal = u.cacheHitTokens + u.cacheMissTokens;
        const cacheRate = cacheTotal > 0 ? Math.round((u.cacheHitTokens / cacheTotal) * 100) : 0;

        // Count tool calls from messages
        const toolCalls = messagesRef.current.filter(m => m.tool_calls).flatMap(m => m.tool_calls!);
        const toolCounts = new Map<string, number>();
        for (const tc of toolCalls) {
          toolCounts.set(tc.function.name, (toolCounts.get(tc.function.name) || 0) + 1);
        }
        const toolBreakdown = [...toolCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => `  ${name}: ${count} 次`)
          .join('\n');

        const msg = [
          `📈 **会话指标**`,
          ``,
          `**Token 用量**`,
          `  输入: ${u.promptTokens.toLocaleString()}`,
          `  输出: ${u.completionTokens.toLocaleString()}`,
          `  总计: ${u.totalTokens.toLocaleString()}`,
          `  缓存命中: ${cacheRate}%`,
          ``,
          `**费用**: $${sessionCost.toFixed(4)}`,
          ``,
          `**工具调用** (${toolCalls.length} 次)`,
          toolBreakdown || '  暂无',
          ``,
          `**消息统计**`,
          `  用户: ${messagesRef.current.filter(m => m.role === 'user').length}`,
          `  助手: ${messagesRef.current.filter(m => m.role === 'assistant').length}`,
          `  工具: ${messagesRef.current.filter(m => m.role === 'tool').length}`,
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        break;
      }

      // ===== 知识库 =====
      case 'kb': {
        const sub = cmdArgs[0] || 'list';
        if (sub === 'add') {
          const title = cmdArgs[1];
          const content = cmdArgs.slice(2).join(' ');
          if (title && content) {
            knowledgeBase.current.add(title, content);
            setMessages(prev => [...prev, { role: 'assistant', content: `📚 已添加知识: **${title}**` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb add <标题> <内容>`' }]);
          }
        } else if (sub === 'search') {
          const query = cmdArgs.slice(1).join(' ');
          if (!query) {
            setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb search <关键词>`' }]);
          } else {
            const results = knowledgeBase.current.search(query);
            if (results.length === 0) {
              setMessages(prev => [...prev, { role: 'assistant', content: `🔍 未找到匹配 "${query}" 的知识` }]);
            } else {
              const list = results.map(e => `- \`${e.id}\` **${e.title}** [${e.tags.join(',')}] ${e.content.slice(0, 60)}...`).join('\n');
              setMessages(prev => [...prev, { role: 'assistant', content: `📚 找到 ${results.length} 条知识:\n${list}` }]);
            }
          }
        } else if (sub === 'del' || sub === 'rm') {
          const id = cmdArgs[1];
          if (id && knowledgeBase.current.delete(id)) {
            setMessages(prev => [...prev, { role: 'assistant', content: `🗑️ 已删除知识: ${id}` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb del <id>`' }]);
          }
        } else if (sub === 'get') {
          const id = cmdArgs[1];
          if (!id) {
            setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb get <id>`' }]);
          } else {
            const entry = knowledgeBase.current.get(id);
            if (entry) {
              setMessages(prev => [...prev, { role: 'assistant', content: `📚 **${entry.title}**\n标签: [${entry.tags.join(', ')}]\n来源: ${entry.source}\n创建: ${entry.created}\n更新: ${entry.updated}\n\n${entry.content}` }]);
            } else {
              setMessages(prev => [...prev, { role: 'assistant', content: `❓ 未找到知识: ${id}` }]);
            }
          }
        } else {
          // list
          const entries = knowledgeBase.current.list();
          if (entries.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: '📚 知识库为空。用 `/kb add <标题> <内容>` 添加知识' }]);
          } else {
            const list = entries.map(e => `- \`${e.id}\` **${e.title}** [${e.tags.join(',')}] ${e.content.slice(0, 60)}...`).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content: `📚 **知识库** (${entries.length} 条)\n${list}\n\n\`/kb add\` 添加 · \`/kb search\` 搜索 · \`/kb get\` 查看 · \`/kb del\` 删除` }]);
          }
        }
        break;
      }

      case 'monitor': {
        const report = monitor.getReport();
        setMessages(prev => [...prev, { role: 'assistant', content: report }]);
        break;
      }

      // Check plugin commands
      default: {
        if (pluginManager.current?.hasCommand(cmd)) {
          pluginManager.current.executeCommand(cmd, cmdArgs).then(result => {
            setMessages(prev => [...prev, { role: 'assistant', content: result }]);
          }).catch(err => {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `❌ 插件命令 "${cmd}" 执行失败: ${err instanceof Error ? err.message : String(err)}`,
            }]);
          });
          break;
        }
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❓ 未知命令: \`/${cmd}\`\n输入 \`/help\` 查看所有可用命令`,
        }]);
      }
    }
  }, []);

  // Handle user input submission
  const handleSubmit = useCallback(async (text: string) => {
    // Handle slash commands
    if (text.startsWith('/')) {
      handleSlashCommand(text);
      return;
    }

    // Handle @-file mentions
    let processedText = text;
    const atMentions = text.match(/@(\S+)/g);
    if (atMentions) {
      for (const mention of atMentions) {
        const filePath = mention.slice(1);
        try {
          const resolved = path.resolve(process.cwd(), filePath);
          if (fs.existsSync(resolved)) {
            const stat = fs.statSync(resolved);
            if (stat.size > 100 * 1024) {
              processedText = processedText.replace(mention, `(文件 ${filePath} 太大: ${(stat.size / 1024).toFixed(0)}KB，已跳过)`);
              continue;
            }
            const content = fs.readFileSync(resolved, 'utf-8');
            processedText = processedText.replace(mention, `\n\nFile: ${filePath}\n\`\`\`\n${content}\n\`\`\``);
          }
        } catch { /* ignore */ }
      }
    }

    // Check for skill triggers
    const skill = findSkillByTrigger(skills.current, text);
    if (skill) {
      processedText = `${skill.content}\n\nUser request: ${text}`;
    }

    const userMessage: Message = { role: 'user', content: processedText };

    // 自动上下文压缩 (对话过长时)
    let historyMessages = messagesRef.current.filter(m => m.role !== 'system');
    if (needsCompaction(historyMessages)) {
      const cfg = configRef.current;
      const compactClient = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
      try {
        const { compacted } = await compactContext(historyMessages, compactClient);
        historyMessages = compacted;
        setMessages([...compacted, userMessage]);
      } catch {
        // 压缩失败就用原消息继续
      }
    }

    // Build full message list for API: system + history + user
    const memoryContext = memoryStore.current.getContextSummary();
    const projectInfo = detectProject();
    const projectContext = [
      `## 当前项目`,
      `- 名称: ${projectInfo.name}`,
      `- 类型: ${projectInfo.type}`,
      `- 语言: ${projectInfo.language}`,
      projectInfo.framework ? `- 框架: ${projectInfo.framework}` : '',
      `- 工作目录: ${process.cwd()}`,
      gitBranch ? `- Git 分支: ${gitBranch}` : '',
    ].filter(Boolean).join('\n');

    // 智能上下文注入：文件树 + package.json + 相关文件
    let smartContext = '';
    if (projectCtx.current) {
      const ctx = projectCtx.current;
      const contextParts: string[] = [];
      if (ctx.fileTree) contextParts.push(`## 项目文件结构\n\`\`\`\n${ctx.fileTree}\n\`\`\``);
      if (ctx.packageInfo) contextParts.push(`## package.json\n${ctx.packageInfo}`);
      if (ctx.tsConfig) contextParts.push(`## TypeScript: ${ctx.tsConfig}`);
      if (ctx.readmeSummary) contextParts.push(`## README 摘要\n${ctx.readmeSummary.slice(0, 300)}`);
      if (ctx.changedFiles.length > 0) contextParts.push(`## 最近变更文件\n${ctx.changedFiles.map(f => `- ${f}`).join('\n')}`);
      // 根据用户消息注入相关文件内容
      const relevantFiles = extractRelevantContext(processedText, process.cwd(), ctx);
      if (relevantFiles) contextParts.push(`## 相关文件\n${relevantFiles}`);
      smartContext = contextParts.join('\n\n');
    }

    // 动态系统提示词: 根据项目类型、对话状态、近期错误实时构建
    const recentErrors = extractRecentErrors(historyMessages);
    const toolCallCount = historyMessages.filter(m => m.tool_calls?.length).length;
    const dynamicSystemPrompt = buildSystemPrompt({
      projectCtx: projectCtx.current,
      config: configRef.current,
      mode: modeRef.current,
      messageCount: historyMessages.length,
      toolCallCount,
      recentErrors,
      userMessage: processedText,
    });

    const systemContent = [
      dynamicSystemPrompt,
      projectContext,
      smartContext,
      memoryContext,
    ].filter(Boolean).join('\n\n');
    const systemMessage: Message = {
      role: 'system',
      content: systemContent,
    };
    const apiMessages = [systemMessage, ...historyMessages, userMessage];

    // Update display messages (without system message)
    setMessages(prev => [...prev, userMessage]);

    // Persist user message to session store
    sessionManager.current.addMessage(userMessage);

    // Create client and agent loop
    const cfg = configRef.current;
    const client = createProvider(cfg.provider.providerType, cfg.provider.apiKey, cfg.provider.baseUrl, cfg.provider.model);
    const toolCtx: ToolContext = {
      sandbox: sandbox.current,
      cwd: process.cwd(),
      workingDirectory: process.cwd(),
    };

    const loop = new AgentLoop(client, toolRegistry.current, toolCtx, cfg.agent.maxIterations, cfg.agent.reasoningEffort);
    agentLoop.current = loop;

    setIsStreaming(true);
    setStreamingContent('');
    setStreamingThinking('');
    setStreamingToolCalls(new Map());
    setToolResults(new Map());
    setIteration(0);

    // 启动节流定时器：每 33ms (≈30fps) 批量刷新一次流式内容
    streamBufferRef.current = { content: '', thinking: '', dirty: false };
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    streamTimerRef.current = setInterval(() => {
      const buf = streamBufferRef.current;
      if (buf.dirty) {
        setStreamingContent(buf.content);
        setStreamingThinking(buf.thinking);
        buf.dirty = false;
      }
    }, 33);

    try {
      const messagesBeforeLoop = messagesRef.current.length;
      const result = await loop.run(modeRef.current, {
        onToken: (token) => {
          streamBufferRef.current.content += token;
          streamBufferRef.current.dirty = true;
        },
        onReasoning: (token) => {
          streamBufferRef.current.thinking += token;
          streamBufferRef.current.dirty = true;
        },
        onThinkingStart: () => {
          setIsThinking(true);
        },
        onThinkingEnd: () => {
          setIsThinking(false);
        },
        onToolStart: (name, _args) => {
          const id = `tool_${name}_${Date.now()}`;
          setToolResults(prev => {
            const next = new Map(prev);
            next.set(id, { status: 'running' });
            return next;
          });
          setIteration(prev => prev + 1);
        },
        onToolCallDelta: (index: number, delta: { name?: string; arguments?: string }) => {
          setStreamingToolCalls(prev => {
            const next = new Map(prev);
            const existing = next.get(index) || { name: '', args: '' };
            next.set(index, {
              name: delta.name || existing.name,
              args: existing.args + (delta.arguments || ''),
            });
            return next;
          });
        },
        onToolResult: (name, result, error) => {
          // Clear all streaming tool calls when any tool completes
          setStreamingToolCalls(new Map());
          setToolResults(prev => {
            const next = new Map(prev);
            for (const [id, val] of next) {
              if (val.status === 'running') {
                next.set(id, {
                  result,
                  error,
                  status: error ? 'failed' : 'completed',
                });
                break;
              }
            }
            return next;
          });
        },
        onUsage: (newUsage) => {
          setUsage(newUsage);
        },
        requestApproval: async (toolName, args) => {
          if (alwaysApprovedTools.current.has(toolName)) {
            return true;
          }
          return new Promise<boolean>((resolve) => {
            setApprovalPending({ toolName, args, resolve });
          });
        },
        onError: (error) => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `❌ 错误: ${error.message}`,
          }]);
        },
      }, apiMessages);

      // 停止节流定时器，刷新剩余缓冲
      if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
      setStreamingContent(streamBufferRef.current.content);
      setStreamingThinking(streamBufferRef.current.thinking);

      // Filter out system messages for display
      const displayMessages = result.messages.filter(m => m.role !== 'system');
      setMessages(displayMessages);
      setUsage(result.usage);
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingThinking('');
      setStreamingToolCalls(new Map());

      // 保存命令历史 + 完成通知 + 成本记录
      commandHistory.current.add(processedText);
      notifyComplete();

      // 自动提交：对话完成后自动执行 git commit
      if (autoCommit.current && !isAutoCommitting.current) {
        isAutoCommitting.current = true;
        setTimeout(() => {
          handleSubmit('请用 shell 执行: git add -A && git commit -m "auto: ' + processedText.slice(0, 50).replace(/"/g, '\\"') + '"');
          setTimeout(() => { isAutoCommitting.current = false; }, 2000);
        }, 500);
      }

      // Persist assistant/tool messages to session store (skip already-persisted user message)
      const newMessages = displayMessages.slice(messagesBeforeLoop);
      for (const msg of newMessages) {
        sessionManager.current.addMessage(msg);
      }
      sessionManager.current.updateUsage(result.usage);
      logCost({
        date: new Date().toISOString().slice(0, 10),
        model: configRef.current.provider.model,
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        cacheHitTokens: result.usage.cacheHitTokens,
        costUsd: calculateCost(configRef.current.provider.model, result.usage.promptTokens, result.usage.completionTokens, result.usage.cacheHitTokens),
        sessionId: sessionManager.current.current?.id || '',
      });

      // 自动会话命名：第一条消息后自动命名
      if (sessionManager.current.current && sessionManager.current.current.name === 'New Session') {
        const name = processedText.slice(0, 30) + (processedText.length > 30 ? '...' : '');
        sessionManager.current.renameSession(name);
      }

      // 工作流链式执行：当前步骤完成后自动执行下一步
      if (activeWorkflow.current) {
        const { workflow, stepIndex } = activeWorkflow.current;
        const nextIdx = stepIndex + 1;
        if (nextIdx < workflow.steps.length) {
          activeWorkflow.current.stepIndex = nextIdx;
          const nextStep = workflow.steps[nextIdx];
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚡ 工作流进度: ${nextIdx + 1}/${workflow.steps.length} - ${nextStep.name}`,
          }]);
          setTimeout(() => handleSubmit(nextStep.prompt), 500);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ 工作流 "${workflow.name}" 已完成！`,
          }]);
          activeWorkflow.current = null;
        }
      }
    } catch (error) {
      if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
      if (!agentLoop.current) return; // Was aborted, don't update state
      setIsStreaming(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 错误: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    }
  }, [handleSlashCommand]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isStreaming) {
        agentLoop.current?.abort();
        agentLoop.current = null;
        if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
        setIsStreaming(false);
        setIsThinking(false);
      } else if (overlay !== 'none') {
        setOverlay('none');
      } else {
        exit();
      }
      return;
    }

    if (overlay !== 'none' || isStreaming || approvalPending) return;

    if (key.ctrl && input === 'k') { setOverlay('command_palette'); return; }
    if (key.ctrl && input === 'r') {
      setSessions(sessionManager.current.listSessions());
      setOverlay('session_picker');
      return;
    }
    if (key.ctrl && input === 'n') {
      sessionManager.current.createSession('New Session', configRef.current.provider.model, modeRef.current);
      setMessages([]);
      setUsage({ ...EMPTY_USAGE });
      return;
    }
    if (key.ctrl && input === 'l') { setMessages([]); return; }
    if (input === '?') { setOverlay('help'); }

    // Alt+1/2/3 快速切换模式 (持久化到配置)
    if (key.meta && input === '1') {
      setMode('plan');
      setConfig(prev => { const u = { ...prev, agent: { ...prev.agent, mode: 'plan' as AgentMode } }; saveConfig(u); return u; });
      return;
    }
    if (key.meta && input === '2') {
      setMode('agent');
      setConfig(prev => { const u = { ...prev, agent: { ...prev.agent, mode: 'agent' as AgentMode } }; saveConfig(u); return u; });
      return;
    }
    if (key.meta && input === '3') {
      setMode('yolo');
      setConfig(prev => { const u = { ...prev, agent: { ...prev.agent, mode: 'yolo' as AgentMode } }; saveConfig(u); return u; });
      return;
    }

    // Ctrl+Z 撤销
    if (key.ctrl && input === 'z') {
      handleSlashCommand('/undo');
      return;
    }
  });

  // Handle command palette selection
  const handleCommandSelect = useCallback((action: string) => {
    setOverlay('none');
    if (action.startsWith('mode:')) {
      const newMode = action.slice(5) as AgentMode;
      setMode(newMode);
      setConfig(prev => { const u = { ...prev, agent: { ...prev.agent, mode: newMode } }; saveConfig(u); return u; });
    } else {
      handleSlashCommand(`/${action}`);
    }
  }, [handleSlashCommand]);

  // Handle session selection
  const handleSessionSelect = useCallback((sessionId: string) => {
    const session = sessionManager.current.resumeSession(sessionId);
    if (session) {
      setMessages(session.messages);
      setUsage(session.token_usage || { ...EMPTY_USAGE });
      setMode(session.mode);
    }
    setOverlay('none');
  }, []);

  // Handle approval
  const handleApproval = useCallback((always: boolean) => {
    if (approvalPending) {
      if (always) alwaysApprovedTools.current.add(approvalPending.toolName);
      approvalPending.resolve(true);
      setApprovalPending(null);
    }
  }, [approvalPending]);

  const handleDenial = useCallback(() => {
    if (approvalPending) {
      approvalPending.resolve(false);
      setApprovalPending(null);
    }
  }, [approvalPending]);

  // Create initial session + config validation
  useEffect(() => {
    if (!needsSetup) {
      sessionManager.current.createSession('New Session', config.provider.model, mode);

      // 配置验证
      const warnings: string[] = [];
      if (!config.provider.apiKey) warnings.push('⚠️ API 密钥未设置，运行 `--setup` 配置');
      else if (config.provider.apiKey.length < 10) warnings.push('⚠️ API 密钥格式异常，可能无效');
      if (!config.provider.baseUrl.includes('mimo') && !config.provider.baseUrl.includes('anthropic') && !config.provider.baseUrl.includes('localhost')) {
        warnings.push(`⚠️ API 地址非 MiMo 官方: ${config.provider.baseUrl}`);
      }
      if (warnings.length > 0) {
        setMessages([{ role: 'assistant', content: `🔧 **配置检查**\n${warnings.join('\n')}\n\n输入 \`/doctor\` 全面诊断` }]);
      }

      // Auto-submit initial prompt if provided
      if (initialPrompt) {
        setTimeout(() => handleSubmit(initialPrompt), 100);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup session manager on unmount
  useEffect(() => {
    return () => {
      sessionManager.current.close();
      mcpClient.current.disconnectAll();
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    };
  }, []);

  // Setup wizard
  if (overlay === 'setup') {
    return (
      <Box flexDirection="column" height="100%">
        <SetupWizard theme={theme} onComplete={handleSetupComplete} onCancel={exit} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Overlays */}
      {overlay === 'command_palette' && (
        <CommandPalette theme={theme} currentMode={mode} onSelect={handleCommandSelect} onClose={() => setOverlay('none')} />
      )}
      {/* Session picker */}
      {overlay === 'session_picker' && (
        <SessionPicker
          sessions={sessions}
          theme={theme}
          onSelect={handleSessionSelect}
          onDelete={(sessionId) => {
            sessionManager.current.deleteSession(sessionId);
            setSessions(sessionManager.current.listSessions());
          }}
          onClose={() => setOverlay('none')}
        />
      )}
      {overlay === 'help' && (
        <HelpOverlay theme={theme} onClose={() => setOverlay('none')} />
      )}

      {/* Approval Dialog */}
      {approvalPending && (
        <ApprovalDialog
          toolName={approvalPending.toolName}
          args={approvalPending.args}
          theme={theme}
          onApprove={handleApproval}
          onDeny={handleDenial}
        />
      )}

      {/* Main chat area */}
      {overlay === 'none' && !approvalPending && (
        <>
          <ChatView
            messages={messages}
            theme={theme}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
            streamingToolCalls={streamingToolCalls}
            isStreaming={isStreaming}
            isThinking={isThinking}
            toolResults={toolResults}
          />
          <InputArea
            theme={theme}
            onSubmit={handleSubmit}
            onCancel={() => {
              if (isStreaming) {
                agentLoop.current?.abort();
                setIsStreaming(false);
                setIsThinking(false);
              }
            }}
            disabled={false}
            placeholder={isStreaming ? 'MiMo is thinking... (Ctrl+C to cancel)' : 'Type a message...'}
            slashCommands={[
              'new', 'fork', 'save', 'list', 'mode', 'model', 'clear', 'compact', 'help', 'retry', 'undo',
              'export', 'git', 'tree', 'project', 'cost', 'theme', 'debug', 'health', 'doctor',
              'history', 'search', 'rename', 'tokens', 'template', 'snippet', 'config',
              'bookmark', 'stats', 'context', 'shortcuts', 'remember', 'forget', 'workflow',
              'suggest', 'watch', 'chain', 'cd', 'think', 'fix', 'improve', 'batch', 'sub', 'tips',
              'parallel', 'explore', 'review', 'status', 'auto', 'pipeline', 'kill', 'clean', 'metrics', 'kb', 'monitor',
            ]}
            initialHistory={commandHistory.current.getAll()}
          />
        </>
      )}

      {/* Status bar */}
      <StatusBar
        mode={mode}
        model={config.provider.model}
        usage={usage}
        theme={theme}
        streaming={isStreaming}
        branch={gitBranch}
        gitDirty={gitDirty}
        iteration={iteration}
        maxIterations={config.agent.maxIterations}
      />
    </Box>
  );
};
