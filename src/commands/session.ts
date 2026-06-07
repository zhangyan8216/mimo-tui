// src/commands/session.ts - Session management commands

import { exportConversation } from '../utils/export.js';
import type { CommandContext } from './types.js';

export function handleSessionCommand(cmd: string, cmdArgs: string[], ctx: CommandContext): void {
  const { setMessages, configRef, modeRef, setUsage, sessionManager, handleSubmit, commandHistory, memoryStore } = ctx;

  switch (cmd) {
    case 'new':
      sessionManager.current.createSession('New Session', configRef.current.provider.model, modeRef.current);
      ctx.setMessages([]);
      setUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
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
        ctx.setMode(cmdArgs[0] as any);
        ctx.setConfig(prev => {
          const updated = { ...prev, agent: { ...prev.agent, mode: cmdArgs[0] as any } };
          const { saveConfig } = require('../config.js');
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

    case 'clear':
      setMessages([]);
      break;

    case 'retry': {
      const msgs = ctx.messages;
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx >= 0) {
        const userContent = msgs[lastUserIdx].content || '';
        setMessages(msgs.slice(0, lastUserIdx));
        setTimeout(() => handleSubmit(userContent), 100);
      }
      break;
    }

    case 'undo': {
      const msgs = ctx.messages;
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
        setMessages([{ role: 'assistant', content: '↩️ 已清空所有对话' }]);
      }
      break;
    }

    case 'export': {
      try {
        const filePath = exportConversation(ctx.messages, cmdArgs[0]);
        setMessages(prev => [...prev, { role: 'assistant', content: `✅ 对话已导出到: \`${filePath}\`` }]);
      } catch (e) {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ 导出失败: ${e instanceof Error ? e.message : String(e)}` }]);
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
      const results = ctx.messages
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
  }
}
