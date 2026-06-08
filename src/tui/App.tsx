// src/tui/App.tsx - Root Ink component

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import fs from 'fs';
import path from 'path';
import type { Config } from '../config.js';
import { saveConfig } from '../config.js';
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
import { multiAgentTool } from '../tools/multi-agent.js';
import { SubAgentPanel } from './SubAgentPanel.js';
import { AgentLoop } from '../agent/loop.js';
import { compactContext, needsCompaction } from '../agent/compact.js';
import { Sandbox } from '../utils/sandbox.js';
import { SessionManager } from '../session/manager.js';
import { loadSkills, findSkillByTrigger } from '../skills/loader.js';
import { getGitInfo } from '../utils/git.js';
import { detectProject } from '../utils/project.js';
import { CommandHistory } from '../utils/history.js';
import { notifyComplete } from '../utils/notify.js';
import { calculateCost, logCost } from '../utils/cost.js';
import { MemoryStore } from '../utils/memory.js';
import type { Workflow } from '../utils/workflow.js';
import { buildProjectContext, extractRelevantContext, type ProjectContext } from '../utils/context.js';
import { buildSystemPrompt, extractRecentErrors } from '../utils/prompt-builder.js';
import { PluginManager } from '../plugins/manager.js';
import { globalHooks } from '../hooks/index.js';
// Lazy-loaded heavy modules (type-only imports for type annotations)
import type { SnippetLibrary } from '../utils/snippets.js';
import type { FileWatcher } from '../utils/watcher.js';
import type { MCPClient } from '../mcp/client.js';
import type { SubAgentManager } from '../agent/sub-agent.js';
import type { KnowledgeBase } from '../utils/knowledge-base.js';
// Command router imports
import { handleSlashCommand as routeCommand } from '../commands/index.js';
import type { CommandContext } from '../commands/types.js';

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
  const gitBranchRef = useRef(gitBranch);
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
  const snippetLibrary = useRef<SnippetLibrary | null>(null);
  const getSnippetLibrary = useCallback((): SnippetLibrary => {
    if (!snippetLibrary.current) snippetLibrary.current = new (require('../utils/snippets.js').SnippetLibrary)();
    return snippetLibrary.current!;
  }, []);
  const memoryStore = useRef(new MemoryStore());
  const fileWatcher = useRef<FileWatcher | null>(null);
  const getFileWatcher = useCallback((): FileWatcher => {
    if (!fileWatcher.current) fileWatcher.current = new (require('../utils/watcher.js').FileWatcher)();
    return fileWatcher.current!;
  }, []);
  const mcpClient = useRef<MCPClient | null>(null);
  const getMcpClient = useCallback((): MCPClient => {
    if (!mcpClient.current) mcpClient.current = new (require('../mcp/client.js').MCPClient)();
    return mcpClient.current!;
  }, []);
  const subAgentManager = useRef<SubAgentManager | null>(null);
  const getSubAgentManager = useCallback((): SubAgentManager => {
    if (!subAgentManager.current) {
      const { SubAgentManager } = require('../agent/sub-agent.js');
      const cfg = configRef.current;
      subAgentManager.current = new SubAgentManager(
        cfg.agent.maxConcurrentAgents || 5,
        cfg.agent.agentTimeout || 120000,
        cfg.agent.enableNestedAgents ? 2 : 0,
      );
    }
    return subAgentManager.current!;
  }, []);
  const pluginManager = useRef<PluginManager | null>(null);
  const knowledgeBase = useRef<KnowledgeBase | null>(null);
  const getKnowledgeBase = useCallback((): KnowledgeBase => {
    if (!knowledgeBase.current) knowledgeBase.current = new (require('../utils/knowledge-base.js').KnowledgeBase)();
    return knowledgeBase.current!;
  }, []);
  const activeWorkflow = useRef<{ workflow: Workflow; stepIndex: number } | null>(null);
  const autoCommit = useRef(false);
  const isAutoCommitting = useRef(false);
  const autoTest = useRef(false);
  const [fileChanges, setFileChanges] = useState<string>('');

  // Ensure subAgentManager is initialized early (needed by multi_agent tool)
  useEffect(() => { getSubAgentManager(); }, []);

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { gitBranchRef.current = gitBranch; }, [gitBranch]);
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
    registry.register(multiAgentTool);
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

  // 构建项目上下文（异步，不阻塞 UI）
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        projectCtx.current = buildProjectContext(process.cwd());
      } catch { /* ignore */ }
    }, 100); // 延迟 100ms，让 UI 先渲染
    return () => clearTimeout(timer);
  }, []);

  // 检测 Git 状态（带超时）
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    getGitInfo().then(info => {
      setGitBranch(info.branch);
      setGitDirty(info.dirty);
    }).catch(() => {});
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  // Load skills
  useEffect(() => {
    skills.current = loadSkills(process.cwd());
  }, []);

  // Connect MCP servers（带超时，不阻塞启动）
  useEffect(() => {
    const servers = config.mcp.servers;
    if (servers.length === 0) return;

    const mcp = getMcpClient();
    const registry = toolRegistry.current;

    (async () => {
      for (const serverCfg of servers) {
        try {
          // 单个 MCP 连接超时 5 秒
          const connectPromise = mcp.connectServer(serverCfg);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MCP 连接超时')), 5000)
          );
          await Promise.race([connectPromise, timeoutPromise]);
        } catch (e) {
          process.stderr.write(`MCP "${serverCfg.name}" 跳过: ${e}\n`);
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
    sessionManager.current.createSession('新会话', newConfig.provider.model, newConfig.agent.mode);
  }, []);

  // Ref for handleSubmit to break circular dependency between handleSlashCommand and handleSubmit
  const handleSubmitRef = useRef<(text: string) => void>(() => {});
  const handleSlashCommandRef = useRef<(text: string) => void>(() => {});

  // Handle slash commands - delegates to command router
  const handleSlashCommand = useCallback((text: string) => {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    const ctx: CommandContext = {
      messages: messagesRef.current,
      setMessages,
      config: configRef.current,
      configRef,
      setConfig,
      mode: modeRef.current,
      modeRef,
      setMode,
      usage,
      setUsage,
      sessionManager,
      agentLoop,
      toolRegistry,
      sandbox,
      handleSubmit: (text: string) => handleSubmitRef.current(text),
      setOverlay: setOverlay as React.Dispatch<React.SetStateAction<string>>,
      setIsStreaming,
      setIsThinking,
      cwd: process.cwd(),
      subAgentManager,
      fileWatcher,
      snippetLibrary,
      memoryStore,
      knowledgeBase,
      commandHistory,
      pluginManager,
      mcpClient,
      activeWorkflow,
      autoCommit,
      autoTest,
      systemPrompt,
      streamTimerRef,
      setFileChanges,
      handleSlashCommand: (t: string) => handleSlashCommandRef.current(t),
    };

    if (!routeCommand(cmd, cmdArgs, ctx)) {
      // Check plugin commands
      if (pluginManager.current?.hasCommand(cmd)) {
        pluginManager.current.executeCommand(cmd, cmdArgs).then(result => {
          setMessages(prev => [...prev, { role: 'assistant', content: result }]);
        }).catch(err => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `❌ 插件命令 "${cmd}" 执行失败: ${err instanceof Error ? err.message : String(err)}`,
          }]);
        });
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❓ 未知命令: \`/${cmd}\`\n输入 \`/help\` 查看所有可用命令`,
        }]);
      }
    }
  }, [usage]);

  // Handle user input submission
  const handleSubmit = useCallback(async (text: string) => {
    // Handle slash commands
    if (text.startsWith('/')) {
      handleSlashCommandRef.current(text);
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
      processedText = `${skill.content}\n\n用户请求: ${text}`;
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
      gitBranchRef.current ? `- Git 分支: ${gitBranchRef.current}` : '',
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
    const toolCtx: ToolContext & { subAgentManager?: SubAgentManager; provider?: typeof client; mode?: AgentMode } = {
      sandbox: sandbox.current,
      cwd: process.cwd(),
      workingDirectory: process.cwd(),
      subAgentManager: subAgentManager.current || undefined,
      provider: client,
      mode: modeRef.current,
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

    let globalTimeoutId: ReturnType<typeof setTimeout> = undefined as any;
    try {
      const messagesBeforeLoop = messagesRef.current.length;
      // 全局超时保护: 5 分钟
      const globalTimeout = new Promise<never>((_, reject) => {
        globalTimeoutId = setTimeout(() => reject(new Error('请求超时（5分钟）。请检查网络连接或简化任务。')), 300000);
      });

      const result = await Promise.race([
        loop.run(modeRef.current, {
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
          // Clear streaming tool calls when any tool completes
          setStreamingToolCalls(new Map());
          setToolResults(prev => {
            const next = new Map(prev);
            // Match by name + running status (most specific match first)
            for (const [id, val] of next) {
              if (val.status === 'running' && id.includes(name)) {
                next.set(id, {
                  result,
                  error,
                  status: error ? 'failed' : 'completed',
                });
                return next;
              }
            }
            // Fallback: mark first running entry
            for (const [id, val] of next) {
              if (val.status === 'running') {
                next.set(id, {
                  result,
                  error,
                  status: error ? 'failed' : 'completed',
                });
                return next;
              }
            }
            return next;
          });
        },
        onUsage: (newUsage) => {
          setUsage(newUsage);
        },
        requestApproval: async (toolName, args) => {
          // 始终批准的工具
          if (alwaysApprovedTools.current.has(toolName)) {
            return true;
          }
          // 会话级记忆：同一文件路径已批准过，自动通过
          const filePath = String(args.path || args.file || '');
          const approvalKey = filePath ? `${toolName}:${filePath}` : toolName;
          if (alwaysApprovedTools.current.has(approvalKey)) {
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
      }, apiMessages),
        globalTimeout,
      ]);

      // 清理全局超时定时器，避免未处理的 reject
      clearTimeout(globalTimeoutId);

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
          // Only keep safe characters to prevent shell injection
          const safeText = processedText.slice(0, 50).replace(/[^a-zA-Z0-9一-鿿 .,\-_]/g, '');
          handleSubmit('请用 shell 执行: git add -A && git commit -m "auto: ' + safeText + '"');
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
      if (sessionManager.current.current && sessionManager.current.current.name === '新会话') {
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
      clearTimeout(globalTimeoutId);
      if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
      if (!agentLoop.current) return; // Was aborted, don't update state
      setIsStreaming(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 错误: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    }
  }, []);

  // Sync refs after both functions are defined
  useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);
  useEffect(() => { handleSlashCommandRef.current = handleSlashCommand; }, [handleSlashCommand]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isStreaming) {
        agentLoop.current?.abort();
        agentLoop.current = null;
        if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
        // Preserve partial streamed content instead of discarding it
        const partial = streamBufferRef.current.content;
        const partialThinking = streamBufferRef.current.thinking;
        if (partial || partialThinking) {
          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            content: partial ? partial + '\n\n⚠️ *(已中断)*' : '⚠️ *(已中断)*',
          }]);
        }
        setIsStreaming(false);
        setIsThinking(false);
        setStreamingContent('');
        setStreamingThinking('');
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
      sessionManager.current.createSession('新会话', configRef.current.provider.model, modeRef.current);
      setMessages([]);
      setUsage({ ...EMPTY_USAGE });
      return;
    }
    if (key.ctrl && input === 'l') { setMessages([]); return; }
    // F1 help: Ctrl+? as fallback since Ink doesn't expose F1
    if (key.ctrl && input === '/') { setOverlay('help'); return; }

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
      if (always) {
        alwaysApprovedTools.current.add(approvalPending.toolName);
        // 也记住文件路径级别的批准
        const filePath = String(approvalPending.args.path || approvalPending.args.file || '');
        if (filePath) {
          alwaysApprovedTools.current.add(`${approvalPending.toolName}:${filePath}`);
        }
      }
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
      sessionManager.current.createSession('新会话', config.provider.model, mode);
      globalHooks.trigger('on-session-start', {});

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
      globalHooks.trigger('on-session-end', {});
      sessionManager.current.close();
      mcpClient.current?.disconnectAll();
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

      {/* Approval Dialog — shown above chat, not replacing it */}
      {approvalPending && (
        <ApprovalDialog
          toolName={approvalPending.toolName}
          args={approvalPending.args}
          theme={theme}
          onApprove={handleApproval}
          onDeny={handleDenial}
        />
      )}

      {/* Main chat area — visible unless a full-screen overlay is active */}
      {overlay === 'none' && (
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
          <SubAgentPanel
            tasks={subAgentManager.current?.getAllTasks() || []}
            theme={theme}
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
            disabled={!!approvalPending}
            placeholder={approvalPending ? '等待审批...' : isStreaming ? 'MiMo 思考中...（Ctrl+C 取消）' : '输入消息...'}
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
