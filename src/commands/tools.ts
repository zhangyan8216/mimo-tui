// src/commands/tools.ts - Tool and utility slash commands

import fs from 'fs';
import path from 'path';
import { saveConfig, DEFAULT_CONFIG, type Config } from '../config.js';
import { createProvider } from '../api/providers/index.js';
import { compactContext } from '../agent/compact.js';
import { Sandbox } from '../utils/sandbox.js';
import { detectProject, formatProjectSummary } from '../utils/project.js';
import { generateFileTree, formatFileTree } from '../utils/filetree.js';
import { checkApiHealth } from '../utils/health.js';
import { generateSuggestions } from '../utils/suggestions.js';
import { monitor } from '../utils/monitor.js';
import { TEMPLATES, getTemplatesByCategory, searchTemplates } from '../utils/templates.js';
import type { CommandContext } from './types.js';

export function handleToolsCommand(cmd: string, cmdArgs: string[], ctx: CommandContext): void {
  const { setMessages, configRef, modeRef, setConfig, usage, handleSubmit, sandbox, toolRegistry, sessionManager,
    memoryStore, snippetLibrary, commandHistory, fileWatcher, autoCommit, autoTest, activeWorkflow,
    knowledgeBase, setFileChanges, setIsStreaming, setIsThinking, streamTimerRef, subAgentManager } = ctx;

  switch (cmd) {
    case 'compact': {
      const client = createProvider(configRef.current.provider.providerType, configRef.current.provider.apiKey, configRef.current.provider.baseUrl, configRef.current.provider.model);
      setMessages(prev => [...prev, { role: 'assistant', content: '⏳ 正在压缩上下文...' }]);
      compactContext(ctx.messages, client, (msg) => {
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
      ctx.setOverlay('help');
      break;

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

    case 'debug': {
      if (cmdArgs[0] === 'agents') {
        const sam = subAgentManager.current;
        if (!sam) { setMessages(prev => [...prev, { role: 'assistant', content: '❌ 子代理管理器未初始化' }]); break; }
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
          `**文件监控**: ${fileWatcher.current?.isWatching ? '运行中' : '未启用'}`,
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
        `消息数: ${ctx.messages.length}`,
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

      checks.push(`**配置**`);
      checks.push(`  API 密钥: ${cfg.provider.apiKey ? `✅ 已设置 (${cfg.provider.apiKey.slice(0, 8)}...)` : '❌ 未设置'}`);
      checks.push(`  API 地址: ${cfg.provider.baseUrl}`);
      checks.push(`  模型: ${cfg.provider.model}`);
      checks.push(`  模式: ${cfg.agent.mode}`);
      checks.push(`  推理深度: ${cfg.agent.reasoningEffort}`);

      const toolNames = toolRegistry.current.allToolNames;
      const expectedTools = ['read_file', 'write_file', 'edit_file', 'shell', 'glob', 'grep', 'web_fetch', 'todo', 'codebase', 'test_runner', 'multi_edit'];
      const missingTools = expectedTools.filter(t => !toolNames.includes(t));
      checks.push(`\n**工具** (${toolNames.length} 个)`);
      checks.push(`  ${missingTools.length === 0 ? '✅ 全部就绪' : `❌ 缺少: ${missingTools.join(', ')}`}`);

      const sessionCount = sessionManager.current.listSessions(100).length;
      const currentSession = sessionManager.current.current;
      checks.push(`\n**会话**`);
      checks.push(`  当前: ${currentSession ? `✅ ${currentSession.name}` : '❌ 无'}`);
      checks.push(`  历史: ${sessionCount} 个`);

      const u = usage;
      const cacheTotal = u.cacheHitTokens + u.cacheMissTokens;
      const cacheRate = cacheTotal > 0 ? Math.round((u.cacheHitTokens / cacheTotal) * 100) : 0;
      checks.push(`\n**缓存**`);
      checks.push(`  命中率: ${cacheRate}% ${cacheRate >= 60 ? '✅' : cacheRate >= 30 ? '⚠️' : '❌ (首轮正常)'}`);

      checks.push(`\n**环境**`);
      checks.push(`  Node: ${process.version}`);
      checks.push(`  平台: ${process.platform} ${process.arch}`);
      checks.push(`  工作目录: ${process.cwd()}`);
      checks.push(`  内存: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

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
        handleSubmit(`请用 shell 工具依次执行以下命令并报告结果:\n${fixes.map(f => f.cmd).join('\n')}`);
      }
      break;
    }

    case 'template':
    case 'tpl': {
      const query = cmdArgs.join(' ');
      if (!query) {
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
      if (!snippetLibrary.current) { setMessages(prev => [...prev, { role: 'assistant', content: '❌ 代码片段库未初始化' }]); break; }
      const snippets = snippetLibrary.current;
      if (sub === 'list') {
        const items = snippets.list();
        if (items.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '📎 代码片段库为空。用 `/snip add <名称> <代码>` 添加' }]);
        } else {
          const list = items.map(s => `\`${s.id}\` **${s.name}** [${s.language}] ${s.content.slice(0, 40)}...`).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `📎 **代码片段** (${items.length} 个)\n${list}` }]);
        }
      } else if (sub === 'add') {
        const name = cmdArgs[1];
        const content = cmdArgs.slice(2).join(' ');
        if (name && content) {
          snippets.add(name, content);
          setMessages(prev => [...prev, { role: 'assistant', content: `✅ 已保存片段: **${name}**` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/snip add <名称> <代码>`' }]);
        }
      } else if (sub === 'search') {
        const query = cmdArgs.slice(1).join(' ');
        const results = snippets.search(query);
        if (results.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: `🔍 未找到匹配 "${query}" 的片段` }]);
        } else {
          const list = results.map(s => `\`${s.id}\` **${s.name}**: ${s.content.slice(0, 60)}...`).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `🔍 找到 ${results.length} 个片段:\n${list}` }]);
        }
      } else if (sub === 'rm') {
        const id = cmdArgs[1];
        if (id && snippets.remove(id)) {
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
        // Deep copy to avoid mutating DEFAULT_CONFIG
        const fresh: Config = {
          provider: { ...DEFAULT_CONFIG.provider },
          agent: { ...DEFAULT_CONFIG.agent },
          ui: { ...DEFAULT_CONFIG.ui },
          mcp: { servers: [...DEFAULT_CONFIG.mcp.servers] },
        };
        saveConfig(fresh);
        setConfig(fresh);
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
          content: `🔖 **当前会话状态**\n消息数: ${ctx.messages.length}\nToken: ${u.totalTokens.toLocaleString()}\n模式: ${modeRef.current}\n模型: ${configRef.current.provider.model}`,
        }]);
      }
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

    // ===== 清理命令 =====
    case 'clean': {
      const sub = cmdArgs[0];
      if (sub === 'sessions') {
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
      if (!fileWatcher.current) { setMessages(prev => [...prev, { role: 'assistant', content: '❌ 文件监控未初始化' }]); break; }
      const fw = fileWatcher.current;
      if (sub === 'start') {
        fw.watch(process.cwd(), (change) => {
          setFileChanges(fw.getSummary());
        });
        setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 开始监控文件变更...' }]);
      } else if (sub === 'test') {
        // 清理之前的定时器，防止泄漏
        if ((fw as any)._testTimer) clearTimeout((fw as any)._testTimer);
        fw.watch(process.cwd(), (change) => {
          setFileChanges(fw.getSummary());
          if ((fw as any)._testTimer) clearTimeout((fw as any)._testTimer);
          const timer = setTimeout(() => {
            setMessages(prev => [...prev, { role: 'assistant', content: `🔄 检测到文件变更，自动运行测试...` }]);
            handleSubmit('请用 test_runner 工具运行项目测试，只报告失败的测试。如果全部通过，只说"✅ 测试通过"。');
          }, 2000);
          (fw as any)._testTimer = timer;
        });
        setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 文件变更自动测试已启动\n修改文件后 2 秒自动运行测试\n`/watch stop` 停止' }]);
      } else if (sub === 'stop') {
        if ((fw as any)._testTimer) clearTimeout((fw as any)._testTimer);
        fw.stop();
        setMessages(prev => [...prev, { role: 'assistant', content: '👁️ 已停止文件监控' }]);
      } else {
        const summary = fw.getSummary();
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
        commands.forEach((cmdItem, i) => {
          setTimeout(() => ctx.handleSlashCommand(cmdItem.startsWith('/') ? cmdItem : `/${cmdItem}`), i * 200);
        });
      }
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
          if (!fileWatcher.current) { setMessages(prev => [...prev, { role: 'assistant', content: '❌ 文件监控未初始化' }]); break; }
          fileWatcher.current.stop(); // 清理之前的 watcher
          fileWatcher.current.watch(process.cwd(), () => {
            handleSubmit('请用 test_runner 运行测试，只报告失败项');
          });
          setMessages(prev => [...prev, { role: 'assistant', content: '🧪 自动测试已开启 - 文件变更时自动运行测试' }]);
        } else {
          fileWatcher.current?.stop();
          setMessages(prev => [...prev, { role: 'assistant', content: '🧪 自动测试已关闭' }]);
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '🤖 **自动化工作流**\n\n`/auto commit` - 切换自动提交\n`/auto test` - 切换自动测试\n\n当前状态: ' + (autoCommit.current ? '自动提交 ✅' : '自动提交 ❌') + ' | ' + (autoTest.current ? '自动测试 ✅' : '自动测试 ❌') }]);
      }
      break;
    }

    // ===== 知识库 =====
    case 'kb': {
      const sub = cmdArgs[0] || 'list';
      if (!knowledgeBase.current) { setMessages(prev => [...prev, { role: 'assistant', content: '❌ 知识库未初始化' }]); break; }
      const kb = knowledgeBase.current;
      if (sub === 'add') {
        const title = cmdArgs[1];
        const content = cmdArgs.slice(2).join(' ');
        if (title && content) {
          kb.add(title, content);
          setMessages(prev => [...prev, { role: 'assistant', content: `📚 已添加知识: **${title}**` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb add <标题> <内容>`' }]);
        }
      } else if (sub === 'search') {
        const query = cmdArgs.slice(1).join(' ');
        if (!query) {
          setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb search <关键词>`' }]);
        } else {
          const results = kb.search(query);
          if (results.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content: `🔍 未找到匹配 "${query}" 的知识` }]);
          } else {
            const list = results.map(e => `- \`${e.id}\` **${e.title}** [${e.tags.join(',')}] ${e.content.slice(0, 60)}...`).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content: `📚 找到 ${results.length} 条知识:\n${list}` }]);
          }
        }
      } else if (sub === 'del' || sub === 'rm') {
        const id = cmdArgs[1];
        if (id && kb.delete(id)) {
          setMessages(prev => [...prev, { role: 'assistant', content: `🗑️ 已删除知识: ${id}` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb del <id>`' }]);
        }
      } else if (sub === 'get') {
        const id = cmdArgs[1];
        if (!id) {
          setMessages(prev => [...prev, { role: 'assistant', content: '用法: `/kb get <id>`' }]);
        } else {
          const entry = kb.get(id);
          if (entry) {
            setMessages(prev => [...prev, { role: 'assistant', content: `📚 **${entry.title}**\n标签: [${entry.tags.join(', ')}]\n来源: ${entry.source}\n创建: ${entry.created}\n更新: ${entry.updated}\n\n${entry.content}` }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `❓ 未找到知识: ${id}` }]);
          }
        }
      } else {
        const entries = kb.list();
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

    // ===== 安装 Skills / MCP =====
    case 'install': {
      const type = cmdArgs[0]; // 'skill' or 'mcp'
      const rest = cmdArgs.slice(1);

      if (!type) {
        setMessages(prev => [...prev, { role: 'assistant', content: '📦 **安装命令**\n\n`/install skill <source>` 安装 Skill\n  - URL: `/install skill https://example.com/skill.md`\n  - npm: `/install skill mimo-skill-code-review`\n  - 本地: `/install skill ./my-skill.md`\n\n`/install mcp <name> <command> [args...]` 安装 MCP 服务器\n  - 示例: `/install mcp filesystem npx -y @modelcontextprotocol/server-filesystem`\n\n`/skills` 查看已安装 Skills\n`/mcp` 查看已连接 MCP 服务器' }]);
        break;
      }

      if (type === 'skill') {
        const source = rest.join(' ');
        if (!source) {
          setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: `/install skill <URL|npm包名|本地路径>`' }]);
          break;
        }
        setMessages(prev => [...prev, { role: 'assistant', content: `📦 正在安装 Skill: ${source}...` }]);
        import('../tools/install.js').then(async ({ installSkill }) => {
          try {
            const result = await installSkill(source);
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ Skill 已安装!\n\n- **名称**: ${result.name}\n- **描述**: ${result.description}\n- **触发词**: ${result.triggers.join(', ') || '(无)'}\n- **路径**: \`${result.path}\`\n- **来源**: ${result.source}`,
            }]);
            // Reload skills if the ref is available
            if (ctx.skills?.current !== undefined) {
              const { loadSkills } = await import('../skills/loader.js');
              ctx.skills.current = loadSkills(process.cwd());
            }
          } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ 安装失败: ${err instanceof Error ? err.message : String(err)}` }]);
          }
        });
        break;
      }

      if (type === 'mcp') {
        if (rest.length < 2) {
          setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: `/install mcp <name> <command> [args...]`\n示例: `/install mcp filesystem npx -y @modelcontextprotocol/server-filesystem`' }]);
          break;
        }
        import('../tools/install.js').then(async ({ parseMcpInstallArgs }) => {
          try {
            const serverConfig = parseMcpInstallArgs(rest.join(' '));
            const { addMcpServer } = await import('../config.js');
            const newConfig = addMcpServer(configRef.current, serverConfig);
            setConfig(newConfig);

            // Connect the new MCP server
            const { MCPClient } = await import('../mcp/client.js');
            const mcpClient = ctx.mcpClient?.current;
            if (mcpClient) {
              setMessages(prev => [...prev, { role: 'assistant', content: `🔌 正在连接 MCP 服务器: ${serverConfig.name}...` }]);
              try {
                await mcpClient.connectServer(serverConfig);
                const defs = mcpClient.getAllToolDefinitions();
                // Register new tools
                for (const def of defs) {
                  const existingTools = toolRegistry.current;
                  if (!existingTools.allToolNames.includes(def.function.name)) {
                    const { MCPClient: MC } = await import('../mcp/client.js');
                    existingTools.register({
                      name: def.function.name,
                      description: def.function.description,
                      parameters: def.function.parameters,
                      execute: async (args) => mcpClient.callTool(serverConfig.name, def.function.name.replace(`mcp_${serverConfig.name}_`, ''), args),
                    });
                  }
                }
                setMessages(prev => [...prev, { role: 'assistant', content: `✅ MCP 服务器 **${serverConfig.name}** 已安装并连接!\n- 命令: \`${serverConfig.command} ${(serverConfig.args || []).join(' ')}\`\n- 已发现 ${defs.length} 个工具\n- 配置已保存到 ~/.mimo/config.toml` }]);
              } catch (err) {
                setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ MCP 服务器已保存到配置，但连接失败: ${err instanceof Error ? err.message : String(err)}\n重启后会自动重试。` }]);
              }
            } else {
              setMessages(prev => [...prev, { role: 'assistant', content: `✅ MCP 服务器 **${serverConfig.name}** 已保存到配置，重启后自动连接。` }]);
            }
          } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ 安装失败: ${err instanceof Error ? err.message : String(err)}` }]);
          }
        });
        break;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: `❓ 未知类型: ${type}。使用 \`skill\` 或 \`mcp\`` }]);
      break;
    }

    case 'uninstall': {
      const type = cmdArgs[0];
      const name = cmdArgs[1];

      if (!type || !name) {
        setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法:\n`/uninstall skill <name>` 卸载 Skill\n`/uninstall mcp <name>` 卸载 MCP 服务器' }]);
        break;
      }

      if (type === 'skill') {
        import('../tools/install.js').then(async ({ uninstallSkill }) => {
          const result = uninstallSkill(name);
          if (result.removed) {
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ Skill **${name}** 已卸载` }]);
            // Reload skills
            if (ctx.skills?.current !== undefined) {
              const { loadSkills } = await import('../skills/loader.js');
              ctx.skills.current = loadSkills(process.cwd());
            }
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ 未找到 Skill: ${name}` }]);
          }
        });
        break;
      }

      if (type === 'mcp') {
        const { removeMcpServer } = require('../config.js');
        const newConfig = removeMcpServer(configRef.current, name);
        setConfig(newConfig);
        setMessages(prev => [...prev, { role: 'assistant', content: `✅ MCP 服务器 **${name}** 已从配置中移除。重启后生效。` }]);
        break;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: `❓ 未知类型: ${type}。使用 \`skill\` 或 \`mcp\`` }]);
      break;
    }

    case 'skills': {
      import('../tools/install.js').then(async ({ listInstalledSkills }) => {
        const skills = listInstalledSkills();
        if (skills.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: '📭 未安装任何 Skill。\n\n用 `/install skill <source>` 安装。' }]);
        } else {
          const list = skills.map(s => {
            const triggers = s.triggers?.length ? ` [${s.triggers.join(', ')}]` : '';
            return `- **${s.name}**${triggers} — ${s.description || '(无描述)'}`;
          }).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `🎯 **已安装 Skills** (${skills.length} 个)\n${list}\n\n\`/install skill\` 安装 · \`/uninstall skill\` 卸载` }]);
        }
      });
      break;
    }

    case 'mcp': {
      const servers = configRef.current.mcp.servers;
      if (servers.length === 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: '📭 未配置任何 MCP 服务器。\n\n用 `/install mcp <name> <command> [args...]` 安装。' }]);
      } else {
        const list = servers.map(s => {
          const cmd = s.transport === 'stdio' ? `\`${s.command} ${(s.args || []).join(' ')}\`` : s.url || '(无)';
          return `- **${s.name}** (${s.transport}) ${cmd}`;
        }).join('\n');
        // Also show connected tools
        const mcpClient = ctx.mcpClient?.current;
        const toolCount = mcpClient ? mcpClient.getAllToolDefinitions().length : 0;
        setMessages(prev => [...prev, { role: 'assistant', content: `🔌 **MCP 服务器** (${servers.length} 个, ${toolCount} 个工具)\n${list}\n\n\`/install mcp\` 安装 · \`/uninstall mcp\` 卸载` }]);
      }
      break;
    }
  }
}
