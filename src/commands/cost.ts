// src/commands/cost.ts - Cost, model, and metrics commands

import { saveConfig } from '../config.js';
import { calculateCost, getCostSummary } from '../utils/cost.js';
import { detectProject } from '../utils/project.js';
import type { CommandContext } from './types.js';

export function handleCostCommand(cmd: string, cmdArgs: string[], ctx: CommandContext): void {
  const { setMessages, setConfig, configRef, usage, modeRef, messages: messagesRef, memoryStore, systemPrompt } = ctx;

  switch (cmd) {
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

    case 'tokens': {
      const u = usage;
      const maxTokens = 128000;
      const pct = Math.round((u.totalTokens / maxTokens) * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      const warning = pct > 80 ? '\n⚠️ **上下文即将用满，建议 /compact 压缩**' : '';
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `📊 **上下文用量** ${pct}%\n\`${bar}\` ${u.totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()}${warning}`,
      }]);
      break;
    }

    case 'stats': {
      const u = usage;
      const msgCount = messagesRef.length;
      const userMsgs = messagesRef.filter(m => m.role === 'user').length;
      const assistantMsgs = messagesRef.filter(m => m.role === 'assistant').length;
      const toolMsgs = messagesRef.filter(m => m.role === 'tool').length;
      const avgResponseLen = assistantMsgs > 0
        ? Math.round(messagesRef.filter(m => m.role === 'assistant').reduce((s, m) => s + (m.content?.length || 0), 0) / assistantMsgs)
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

    case 'metrics': {
      const u = usage;
      const sessionCost = calculateCost(configRef.current.provider.model, u.promptTokens, u.completionTokens, u.cacheHitTokens);
      const cacheTotal = u.cacheHitTokens + u.cacheMissTokens;
      const cacheRate = cacheTotal > 0 ? Math.round((u.cacheHitTokens / cacheTotal) * 100) : 0;

      const toolCalls = messagesRef.filter(m => m.tool_calls).flatMap(m => m.tool_calls!);
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
        `  用户: ${messagesRef.filter(m => m.role === 'user').length}`,
        `  助手: ${messagesRef.filter(m => m.role === 'assistant').length}`,
        `  工具: ${messagesRef.filter(m => m.role === 'tool').length}`,
      ].join('\n');
      setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
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
      if (messagesRef.length > 50) {
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

    case 'context': {
      const msgs = messagesRef.filter(m => m.role !== 'system');
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
  }
}
