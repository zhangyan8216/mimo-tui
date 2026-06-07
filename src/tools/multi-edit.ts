// src/tools/multi-edit.ts - Edit multiple files in one atomic operation

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext } from './registry.js';

export const multiEditTool: Tool = {
  name: 'multi_edit',
  description: '原子化批量编辑多个文件。先验证所有编辑是否合法，全部通过后才执行。适合跨文件重构、批量重命名等。',
  parameters: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: '文件路径',
            },
            old_text: {
              type: 'string',
              description: '要替换的原文（必须在文件中唯一）',
            },
            new_text: {
              type: 'string',
              description: '替换后的新文本',
            },
          },
          required: ['file', 'old_text', 'new_text'],
        },
        description: '编辑操作数组。示例: [{"file": "a.ts", "old_text": "old", "new_text": "new"}]',
      },
    },
    required: ['edits'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const edits = args.edits as Array<{ file: string; old_text: string; new_text: string }>;

    if (!Array.isArray(edits) || edits.length === 0) {
      throw new Error('edits must be a non-empty array of edit operations');
    }

    // Phase 1: Validate all edits without modifying anything
    interface ValidatedEdit {
      resolved: string;
      oldText: string;
      newText: string;
      content: string;
    }
    const validated: ValidatedEdit[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit.file || !edit.old_text || edit.new_text === undefined) {
        throw new Error(`Edit #${i + 1}: missing required fields (file, old_text, new_text)`);
      }

      const filePath = resolvePath(edit.file, ctx.cwd);
      const validation = ctx.sandbox.validatePath(filePath);
      if (!validation.allowed) {
        throw new Error(`Edit #${i + 1}: access denied - ${validation.reason}`);
      }

      if (!fs.existsSync(validation.resolved)) {
        throw new Error(`Edit #${i + 1}: file not found - ${validation.resolved}`);
      }

      const content = fs.readFileSync(validation.resolved, 'utf-8');

      if (!content.includes(edit.old_text)) {
        throw new Error(`Edit #${i + 1}: old_text not found in ${edit.file}\nText: ${edit.old_text}`);
      }

      const count = content.split(edit.old_text).length - 1;
      if (count > 1) {
        throw new Error(
          `Edit #${i + 1}: found ${count} occurrences of old_text in ${edit.file}. It must be unique.`
        );
      }

      validated.push({
        resolved: validation.resolved,
        oldText: edit.old_text,
        newText: edit.new_text,
        content,
      });
    }

    // Phase 2: Apply all edits (all validations passed)
    const results: string[] = [];
    for (const v of validated) {
      const updated = v.content.replace(v.oldText, v.newText);
      fs.writeFileSync(v.resolved, updated, 'utf-8');
      const oldLines = v.oldText.split('\n').length;
      const newLines = v.newText.split('\n').length;
      results.push(`${v.resolved}: 替换 ${oldLines} 行为 ${newLines} 行`);
    }

    return `已应用 ${results.length} 处编辑:\n${results.join('\n')}`;
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
