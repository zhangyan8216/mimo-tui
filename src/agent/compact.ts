// src/agent/compact.ts - 上下文压缩
// 当对话过长时，用 MiMo Flash 总结旧消息，节省 token

import type { Message, TokenUsage } from '../api/types.js';
import { MiMoClient } from '../api/client.js';
import { log } from '../utils/logger.js';

// 上下文阈值 (字符数)
const COMPACT_THRESHOLD = 50000;
// 保留最近 N 条消息不动
const KEEP_RECENT = 6;

/**
 * 估算消息的 token 数 (粗略: 1 中文字 ≈ 2 token, 1 英文词 ≈ 1.3 token)
 */
export function estimateTokens(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (msg.content) totalChars += msg.content.length;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        totalChars += tc.function.name.length + tc.function.arguments.length;
      }
    }
  }
  // 粗略估算
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
 * 压缩上下文 - 将旧消息总结为一条摘要
 */
export async function compactContext(
  messages: Message[],
  client: MiMoClient,
  onProgress?: (msg: string) => void,
): Promise<{ compacted: Message[]; savedTokens: number }> {
  if (messages.length <= KEEP_RECENT) {
    return { compacted: messages, savedTokens: 0 };
  }

  // 分离旧消息和新消息
  const oldMessages = messages.slice(0, -KEEP_RECENT);
  const recentMessages = messages.slice(-KEEP_RECENT);

  const oldText = oldMessages
    .map(m => `[${m.role}]: ${m.content?.slice(0, 500) || '(工具调用)'}`)
    .join('\n');

  onProgress?.('正在压缩上下文...');

  try {
    // 用非流式调用总结旧消息
    const summaryMessages: Message[] = [
      { role: 'system', content: '你是一个对话摘要助手。请将以下对话历史压缩为简洁的摘要，保留关键信息（做了什么修改、遇到的错误、当前进度）。用中文回答，不超过500字。' },
      { role: 'user', content: `请总结以下对话历史:\n\n${oldText}` },
    ];

    const result = await client.chat(summaryMessages, undefined, {
      maxTokens: 800,
      reasoningEffort: 'low',
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
