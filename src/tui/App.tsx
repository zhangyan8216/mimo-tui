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
import { MiMoClient } from '../api/client.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { readFileTool } from '../tools/read-file.js';
import { writeFileTool } from '../tools/write-file.js';
import { editFileTool } from '../tools/edit-file.js';
import { shellTool } from '../tools/shell.js';
import { globTool } from '../tools/glob.js';
import { grepTool } from '../tools/grep.js';
import { webFetchTool } from '../tools/web-fetch.js';
import { todoTool } from '../tools/todo.js';
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
import { BUILTIN_WORKFLOWS, searchWorkflows } from '../utils/workflow.js';
import { FileWatcher } from '../utils/watcher.js';
import { generateSuggestions } from '../utils/suggestions.js';
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
    return registry;
  })());

  const sandbox = useRef(new Sandbox(process.cwd()));

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

      case 'mode':
        if (cmdArgs[0] && ['plan', 'agent', 'yolo'].includes(cmdArgs[0])) {
          setMode(cmdArgs[0] as AgentMode);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Switched to **${cmdArgs[0]}** mode.`,
          }]);
        }
        break;

      case 'model':
        if (cmdArgs[0]) {
          setConfig(prev => ({ ...prev, provider: { ...prev.provider, model: cmdArgs[0] } }));
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Switched model to **${cmdArgs[0]}**.`,
          }]);
        }
        break;

      case 'clear':
        setMessages([]);
        break;

      case 'compact': {
        const client = new MiMoClient(configRef.current.provider.baseUrl, configRef.current.provider.apiKey, configRef.current.provider.model);
        setMessages(prev => [...prev, { role: 'assistant', content: '⏳ 正在压缩上下文...' }]);
        compactContext(messagesRef.current, client, (msg) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: `⏳ ${msg}` };
            return updated;
          });
        }).then(({ compacted, savedTokens }) => {
          setMessages(compacted);
          if (savedTokens > 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ 上下文已压缩，节省约 ${savedTokens} tokens` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: '✅ 上下文无需压缩' }]);
          }
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
        // 重试上一条用户消息
        if (messagesRef.current.length >= 1) {
          const lastUserMsg = [...messagesRef.current].reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
            // 移除最后的 assistant 回复
            const filtered = messagesRef.current.filter((m, i) => {
              if (m.role === 'assistant' && i === messagesRef.current.length - 1) return false;
              return true;
            });
            setMessages(filtered);
            // 重新提交
            setTimeout(() => handleSubmit(lastUserMsg.content || ''), 100);
          }
        }
        break;

      case 'undo':
        // 撤销到上一轮
        if (messagesRef.current.length >= 2) {
          // 找到最后一个 user 消息的位置
          let lastUserIdx = -1;
          for (let i = messagesRef.current.length - 1; i >= 0; i--) {
            if (messagesRef.current[i].role === 'user') { lastUserIdx = i; break; }
          }
          if (lastUserIdx > 0) {
            setMessages(messagesRef.current.slice(0, lastUserIdx));
            setMessages(prev => [...prev, { role: 'assistant', content: '↩️ 已撤销到上一轮' }]);
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
          setConfig(prev => ({ ...prev, ui: { ...prev.ui, theme: themeName } }));
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
        ].join('\n');
        setMessages(prev => [...prev, { role: 'assistant', content: debugInfo }]);
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

        const msg = [
          `📊 **会话统计**`,
          ``,
          `消息总数: ${msgCount}`,
          `  用户: ${userMsgs} | 助手: ${assistantMsgs} | 工具: ${toolMsgs}`,
          `平均回复长度: ${avgResponseLen} 字符`,
          `Token 使用: ${u.totalTokens.toLocaleString()}`,
          `  缓存命中率: ${u.totalTokens > 0 ? Math.round((u.cacheHitTokens / (u.cacheHitTokens + u.cacheMissTokens)) * 100) : 0}%`,
        ].join('\n');
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
          `\`Enter\` 发送         \`Esc\` 关闭弹窗`,
          `\`↑/↓\` 历史记录      \`Ctrl+U\` 清空行`,
          `\`Ctrl+A\` 行首        \`Ctrl+E\` 行尾`,
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
          for (const wf of BUILTIN_WORKFLOWS) {
            lines.push(`\`${wf.id}\` **${wf.name}** - ${wf.description}`);
            lines.push(`  步骤: ${wf.steps.map(s => s.name).join(' → ')}`);
          }
          lines.push('\n用法: `/wf <id>` 执行工作流');
          setMessages(prev => [...prev, { role: 'assistant', content: lines.join('\n') }]);
        } else if (sub === 'search') {
          const query = cmdArgs.slice(1).join(' ');
          const results = searchWorkflows(query);
          const list = results.map(w => `\`${w.id}\` ${w.name}: ${w.description}`).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: list || '未找到匹配的工作流' }]);
        } else {
          const wf = BUILTIN_WORKFLOWS.find(w => w.id === sub);
          if (wf) {
            // 执行工作流：依次提交每一步的提示词
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `⚡ 执行工作流: **${wf.name}**\n步骤: ${wf.steps.map(s => s.name).join(' → ')}\n\n开始第一步: ${wf.steps[0].name}`,
            }]);
            // 自动提交第一步
            setTimeout(() => handleSubmit(wf.steps[0].prompt), 500);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `❓ 工作流 "${sub}" 不存在。输入 \`/wf\` 查看所有工作流` }]);
          }
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
        } else if (sub === 'stop') {
          fileWatcher.current.stop();
          setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 已停止文件监控' }]);
        } else {
          const summary = fileWatcher.current.getSummary();
          setMessages(prev => [...prev, { role: 'assistant', content: `👁️ **文件变更**\n${summary}` }]);
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

      default:
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❓ 未知命令: \`/${cmd}\`\n输入 \`/help\` 查看所有可用命令`,
        }]);
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
      const compactClient = new MiMoClient(cfg.provider.baseUrl, cfg.provider.apiKey, cfg.provider.model);
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

    const systemContent = [
      systemPrompt.current || '你是 MiMo，一个终端 AI 编程助手。',
      projectContext,
      memoryContext,
    ].filter(Boolean).join('\n\n');
    const systemMessage: Message = {
      role: 'system',
      content: systemContent,
    };
    const apiMessages = [systemMessage, ...historyMessages, userMessage];

    // Update display messages (without system message)
    setMessages(prev => [...prev, userMessage]);

    // Create client and agent loop
    const cfg = configRef.current;
    const client = new MiMoClient(cfg.provider.baseUrl, cfg.provider.apiKey, cfg.provider.model);
    const toolCtx: ToolContext = {
      sandbox: sandbox.current,
      cwd: process.cwd(),
      workingDirectory: process.cwd(),
    };

    const loop = new AgentLoop(client, toolRegistry.current, toolCtx, cfg.agent.maxIterations);
    agentLoop.current = loop;

    setIsStreaming(true);
    setStreamingContent('');
    setStreamingThinking('');
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
        onToolResult: (name, result, error) => {
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

      // 保存命令历史 + 完成通知 + 成本记录
      commandHistory.current.add(processedText);
      notifyComplete();
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
    } catch (error) {
      if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
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

    // Alt+1/2/3 快速切换模式
    if (key.meta && input === '1') { setMode('plan'); return; }
    if (key.meta && input === '2') { setMode('agent'); return; }
    if (key.meta && input === '3') { setMode('yolo'); return; }

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
      setMode(action.slice(5) as AgentMode);
    } else {
      handleSlashCommand(`/${action}`);
    }
  }, [handleSlashCommand]);

  // Handle session selection
  const handleSessionSelect = useCallback((sessionId: string) => {
    const session = sessionManager.current.resumeSession(sessionId);
    if (session) {
      setMessages(session.messages);
      setUsage(session.token_usage);
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

  // Create initial session
  useEffect(() => {
    if (!needsSetup) {
      sessionManager.current.createSession('New Session', config.provider.model, mode);
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
      {overlay === 'session_picker' && (
        <SessionPicker sessions={sessions} theme={theme} onSelect={handleSessionSelect} onClose={() => setOverlay('none')} />
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
