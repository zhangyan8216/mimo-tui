// src/utils/prompt-builder.ts - 动态系统提示词构建器
// 根据项目类型、任务上下文、用户历史构建最优系统提示词

import type { Config } from '../config.js';
import type { ProjectContext } from './context.js';
import { analyzeTask } from './task-planner.js';

interface PromptBuilderInput {
  projectCtx: ProjectContext | null;
  config: Config;
  mode: string;
  messageCount: number;
  toolCallCount: number;
  recentErrors: string[];
  userMessage?: string;  // 当前用户消息，用于任务分析
}

let cachedPrompt: string | null = null;
let cachedPromptKey = '';

export function clearPromptCache(): void {
  cachedPrompt = null;
  cachedPromptKey = '';
}

/**
 * 构建动态系统提示词
 * 根据项目类型和对话状态实时调整，让 MiMo 始终处于最佳状态
 */
export function buildSystemPrompt(input: PromptBuilderInput): string {
  const { projectCtx, config, mode, messageCount, toolCallCount, recentErrors } = input;

  // Cache: rebuild prompt only when significant state changes
  // Never use cache when userMessage is provided (task analysis is message-specific)
  // Never cache a result that was built with userMessage (would be stale)
  const key = JSON.stringify({
    mode: input.mode,
    msgBucket: Math.floor(messageCount / 5),
    errorCount: recentErrors.length,
  });
  if (cachedPrompt && cachedPromptKey === key && !input.userMessage) {
    return cachedPrompt;
  }

  const sections: string[] = [];

  // ===== 核心身份 =====
  sections.push(`你是 MiMo，终端 AI 编程助手。你直接操作用户的代码项目。

## 绝对规则
1. 修改文件前必须先 read_file 读取，从结果中复制 old_string
2. 不要编造不存在的代码。不确定就先读取或搜索
3. 完成后用 shell 编译或 test_runner 测试验证
4. 简洁回复。说完做什么，直接调工具`);

  // ===== 任务分析（根据用户消息自动注入） =====
  if (input.userMessage) {
    const taskAnalysis = analyzeTask(input.userMessage);
    if (taskAnalysis) {
      sections.push(taskAnalysis);
    }
  }

  // ===== 项目上下文 =====
  if (projectCtx) {
    const ctxParts: string[] = [];

    // 项目类型特定指令
    if (projectCtx.packageInfo.includes('react') || projectCtx.packageInfo.includes('next')) {
      ctxParts.push('项目类型: React/Next.js。修改组件后检查 props 类型是否匹配。');
    }
    if (projectCtx.packageInfo.includes('typescript')) {
      ctxParts.push('项目类型: TypeScript。修改后运行 npx tsc --noEmit 验证类型。');
    }
    if (projectCtx.packageInfo.includes('vitest') || projectCtx.packageInfo.includes('jest')) {
      ctxParts.push('项目有测试框架。修改后运行 test_runner 验证。');
    }

    // 可用脚本
    const scriptsMatch = projectCtx.packageInfo.match(/脚本:\n([\s\S]*?)(?=\n依赖|$)/);
    if (scriptsMatch) {
      ctxParts.push(`可用命令:\n${scriptsMatch[1]}`);
    }

    // 变更文件
    if (projectCtx.changedFiles.length > 0) {
      ctxParts.push(`最近变更: ${projectCtx.changedFiles.slice(0, 10).join(', ')}`);
    }

    if (ctxParts.length > 0) {
      sections.push(`## 项目信息\n${ctxParts.join('\n')}`);
    }
  }

  // ===== 模式特定指令 =====
  if (mode === 'plan') {
    sections.push(`## 当前模式: 计划（只读）
你只能读取和分析代码，不能修改。用 codebase、read_file、grep、glob 工具探索项目，给出分析和建议。`);
  } else if (mode === 'yolo') {
    sections.push(`## 当前模式: 自动
所有操作自动执行，不需要用户确认。快速高效地完成任务。`);
  }

  // ===== 动态调整指令 =====
  if (recentErrors.length > 0) {
    sections.push(`## 近期错误提醒
你最近犯了这些错误，不要再重复:
${recentErrors.map(e => `- ${e}`).join('\n')}
请特别注意：修改文件前先 read_file，old_string 必须从文件内容中精确复制。`);
  }

  if (messageCount > 20) {
    sections.push(`## 对话较长
当前对话已有 ${messageCount} 条消息。用户可能需要 /compact 压缩上下文。专注于当前任务，不要重复之前的讨论。`);
  }

  // ===== 工具使用指南 =====
  sections.push(`## 工具使用

**修改文件的标准流程:**
1. read_file 读取文件 → 2. 从结果中找到要改的代码 → 3. 复制为 old_string → 4. edit_file 替换

**找不到文件时:** 用 glob 搜索 "**/*关键词*"
**找不到代码时:** 用 grep 搜索 "function\\s+名称" 或 "关键词"
**理解项目时:** 用 codebase(action=index) 扫描全貌

**批量修改:** 用 multi_edit 一次编辑多个文件
**运行测试:** 用 test_runner(action=run)
**执行命令:** 用 shell(command="命令")`);

  // ===== 回复风格 =====
  sections.push(`## 回复规范
- 用中文
- 先说要做什么（一句话）→ 调工具 → 完成后总结
- 文件路径用 path:line 格式
- 不要输出大段解释，直接行动`);

  const result = sections.join('\n\n');
  // Only cache the base prompt (without message-specific task analysis)
  if (!input.userMessage) {
    cachedPrompt = result;
    cachedPromptKey = key;
  }
  return result;
}

/**
 * 从对话历史中提取最近的错误
 */
export function extractRecentErrors(messages: Array<{ role: string; content: string | null }>): string[] {
  const errors: string[] = [];
  for (const msg of messages.slice(-10)) {
    if (msg.role === 'tool' && msg.content?.startsWith('错误:')) {
      const errorLine = msg.content.split('\n')[0].slice(0, 100);
      if (!errors.includes(errorLine)) errors.push(errorLine);
    }
  }
  return errors.slice(-3); // 最多保留 3 条
}
