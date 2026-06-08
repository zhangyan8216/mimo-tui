// src/utils/export.ts - 导出对话为 Markdown

import fs from 'fs';
import path from 'path';
import type { Message } from '../api/types.js';

/** 将对话导出为 Markdown 文件 */
export function exportConversation(messages: Message[], filePath?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultPath = path.join(process.cwd(), `mimo-conversation-${timestamp}.md`);
  const targetPath = filePath || defaultPath;

  const lines: string[] = [];
  lines.push(`# Mimo TUI 对话记录`);
  lines.push('');
  lines.push(`导出时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`消息数: ${messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      lines.push('## 👤 你');
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');
    } else if (msg.role === 'assistant') {
      lines.push('## 🤖 MiMo');
      lines.push('');

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          lines.push(`> 🔧 工具调用: \`${tc.function.name}\``);
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            lines.push(`> 参数: \`${JSON.stringify(args, null, 2)}\``);
          } catch {
            lines.push(`> 参数: \`${tc.function.arguments}\``);
          }
          lines.push('');
        }
      }

      if (msg.content) {
        lines.push(msg.content);
      }
      lines.push('');
    } else if (msg.role === 'tool') {
      lines.push('## 🔧 工具结果');
      lines.push('');
      if (msg.name) lines.push(`工具: \`${msg.name}\``);
      if (msg.tool_call_id) lines.push(`ID: \`${msg.tool_call_id}\``);
      lines.push('');
      lines.push('```');
      lines.push(msg.content || '(无输出)');
      lines.push('```');
      lines.push('');
    }
  }

  const content = lines.join('\n');
  fs.writeFileSync(targetPath, content, 'utf-8');
  return targetPath;
}
