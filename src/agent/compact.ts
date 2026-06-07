// src/agent/compact.ts - 上下文压缩 (MiMo 优化版)
// 当对话过长时，用 MiMo 总结旧消息，节省 token
// 优化: 保留工具调用的文件路径和错误信息，更精确的 token 估算

import type { Message, TokenUsage } from '../api/types.js';
import type { ProviderAdapter } from '../api/provider.js';
import { log } from '../utils/logger.js';

// 上下文阈值 (字符数) - 约 60-80K tokens for mixed CN/EN content
const COMPACT_THRESHOLD = 200000;
// 保留最近 N 条消息不动
const KEEP_RECENT = 8;

/**
 * MiMo 优化的 token 估算
 * 中文字符 ≈ 2 token，英文字符 ≈ 0.25 token，工具调用额外开销
 */
export function estimateTokens(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (msg.content) totalChars += msg.content.length;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        totalChars += tc.function.name.length + tc.function.arguments.length + 20; // 工具调用结构开销
      }
    }
  }
  // MiMo 中英混合内容的 token 比率
  return Math.ceil(totalChars * 1.5);
}

/**
 * 检查是否需要压缩
 */
export function needsCompaction(messages: Message[]): boolean {
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  return totalChars > COMPACT_THRESHOLD;
}

/**
 * 格式化单条消息用于摘要 - 保留关键信息
 */
function formatMessageForSummary(msg: Message, idx: number): string {
  const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : msg.role === 'tool' ? '工具' : '系统';
  let text = `[${role}] `;

  if (msg.name) text += `(${msg.name}) `;

  // 内容: 保留更多上下文
  if (msg.content) {
    // 保留错误信息的完整内容
    if (msg.content.startsWith('Error:')) {
      text += msg.content.slice(0, 300);
    } else {
      text += msg.content.slice(0, 400);
    }
  }

  // 工具调用: 保留工具名和关键参数
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    const toolInfo = msg.tool_calls.map(tc => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* skip */ }
      const keyArg = args.path || args.command || args.pattern || args.url || '';
      return `${tc.function.name}(${String(keyArg).slice(0, 60)})`;
    }).join(', ');
    text += `[工具调用: ${toolInfo}]`;
  }

  return text;
}

/**
 * 压缩上下文 - MiMo 优化版
 * 保留工具调用的文件路径和错误信息，生成更有用的摘要
 */
export async function compactContext(
  messages: Message[],
  client: ProviderAdapter,
  onProgress?: (msg: string) => void,
  model?: string,
): Promise<{ compacted: Message[]; savedTokens: number }> {
  if (messages.length <= KEEP_RECENT) {
    return { compacted: messages, savedTokens: 0 };
  }

  // 分离旧消息和新消息
  const oldMessages = messages.slice(0, -KEEP_RECENT);
  const recentMessages = messages.slice(-KEEP_RECENT);

  // 优化: 用结构化格式代替简单的 [role]: content
  const oldText = oldMessages
    .map((m, i) => formatMessageForSummary(m, i))
    .join('\n');

  onProgress?.('正在压缩上下文...');

  try {
    // MiMo 优化的摘要提示词 - 结构化输出
    const summaryMessages: Message[] = [
      {
        role: 'system',
        content: `你是对话摘要助手。将以下对话历史压缩为结构化摘要。

摘要格式:
1. **任务目标**: 用户想做什么
2. **已完成的操作**: 具体修改了哪些文件，做了什么改动
3. **遇到的问题**: 出现的错误和解决方案
4. **当前进度**: 还剩什么没做
5. **关键上下文**: 重要的文件路径、变量名、函数名

规则:
- 保留所有文件路径和具体操作
- 保留未解决的错误信息
- 用中文回答
- 不超过 800 字`
      },
      { role: 'user', content: `请总结以下对话历史:\n\n${oldText}` },
    ];

    // MiMo 模型路由: 用 Flash（便宜快速）做摘要，不用 Pro
    const result = await client.chat(summaryMessages, undefined, {
      maxTokens: 1200,
      reasoningEffort: 'low',
      model: model || undefined,  // If not provided, use client's default model
    });

    const summary = result.message.content || '对话摘要生成失败';
    const savedTokens = estimateTokens(oldMessages) - estimateTokens([{ role: 'assistant', content: summary }]);

    log('info', `上下文压缩完成，节省约 ${savedTokens} tokens`);

    const compacted: Message[] = [
      { role: 'assistant', content: `📋 **对话摘要** (已压缩 ${oldMessages.length} 条消息)\n\n${summary}` },
      ...recentMessages,
    ];

    return { compacted, savedTokens };
  } catch (err) {
    log('warn', '上下文压缩失败', err);
    return { compacted: messages, savedTokens: 0 };
  }
}
