// src/agent/loop.ts - Main agent loop (stream → tool → stream)
// Handles Anthropic Messages API streaming format

import type { Message, ToolCall, TokenUsage, AgentMode } from '../api/types.js';
import type { ProviderAdapter, StreamEvent } from '../api/provider.js';
import { repairJson } from '../api/providers/anthropic.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { isToolAllowedInMode, needsApproval, isReadOnlyTool } from './modes.js';
import { accumulateUsage } from '../utils/tokens.js';
import { log } from '../utils/logger.js';
import { monitor } from '../utils/monitor.js';
import { globalHooks } from '../hooks/index.js';

export interface AgentLoopCallbacks {
  onToken?: (token: string) => void;
  onReasoning?: (token: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>, index?: number) => void;
  onToolResult?: (name: string, result: string, error?: string) => void;
  onToolCallDelta?: (index: number, delta: { name?: string; arguments?: string }) => void;
  onUsage?: (usage: TokenUsage) => void;
  onThinkingStart?: () => void;
  onThinkingEnd?: () => void;
  onError?: (error: Error) => void;
  requestApproval?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

export class AgentLoop {
  private client: ProviderAdapter;
  private tools: ToolRegistry;
  private toolContext: ToolContext;
  private maxIterations: number;
  private configuredReasoningEffort: string;
  private messages: Message[] = [];
  private toolCallIndex = 0;
  private totalUsage: TokenUsage = {
    promptTokens: 0, completionTokens: 0, totalTokens: 0,
    cacheHitTokens: 0, cacheMissTokens: 0,
  };

  constructor(
    client: ProviderAdapter,
    tools: ToolRegistry,
    toolContext: ToolContext,
    maxIterations = 32,
    reasoningEffort = 'auto',
  ) {
    this.client = client;
    this.tools = tools;
    this.toolContext = toolContext;
    this.maxIterations = maxIterations;
    this.configuredReasoningEffort = reasoningEffort;
  }

  async run(
    mode: AgentMode,
    callbacks: AgentLoopCallbacks,
    messages: Message[],
  ): Promise<{ messages: Message[]; usage: TokenUsage }> {
    this.messages = [...messages];
    this.totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    this.filesReadThisTurn = new Set(); // 重置已读文件列表
    this.toolCallIndex = 0; // 重置工具调用索引

    let iterations = 0;
    let consecutiveEmptyResponses = 0;  // MiMo 空响应计数
    let consecutiveToolErrors = 0;       // 连续工具错误计数

    while (iterations < this.maxIterations) {
      iterations++;
      monitor.startTimer('iteration');
      log('debug', `Agent loop iteration ${iterations}`);

      const toolDefs = this.getToolsForMode(mode);
      this.toolCallIndex = 0; // Reset per iteration

      // Hook: pre-send
      await globalHooks.trigger('pre-send', { messages: this.messages });

      // MiMo 推理预算: 使用配置值或自动调整
      let reasoningEffort: 'low' | 'medium' | 'high' = 'medium';
      if (this.configuredReasoningEffort !== 'auto') {
        reasoningEffort = this.configuredReasoningEffort as 'low' | 'medium' | 'high';
      } else {
        const msgCount = this.messages.length;
        const recentToolCalls = this.messages.slice(-6).filter(m => m.tool_calls?.length).length;
        if (msgCount <= 3 && recentToolCalls === 0) reasoningEffort = 'low';
        else if (recentToolCalls >= 3 || iterations > 3) reasoningEffort = 'high';
      }

      let content = '';
      let reasoning = '';
      const toolCalls: ToolCall[] = [];
      let isThinking = false;
      const activeBlocks = new Map<number, { type: string; toolCallIdx: number }>();

      // Issue #59: 无限重复循环检测
      const recentChunks: string[] = [];
      let repetitionCount = 0;
      const REPETITION_THRESHOLD = 5;

      try {
        for await (const event of this.client.streamChat(this.messages, toolDefs, {
          reasoningEffort,
          thinkingEnabled: true,
        })) {
          if (this.client.isAborted) break;

          this.handleStreamEvent(event, {
            onText: (text) => {
              if (isThinking) {
                isThinking = false;
                callbacks.onThinkingEnd?.();
              }
              content += text;
              callbacks.onToken?.(text);

              recentChunks.push(text);
              if (recentChunks.length > 20) recentChunks.shift();
              if (detectRepetition(recentChunks, REPETITION_THRESHOLD)) {
                repetitionCount++;
                if (repetitionCount >= REPETITION_THRESHOLD) {
                  log('warn', '检测到无限重复循环，自动停止 (Issue #59)');
                  this.abort();
                }
              }
            },
            onThinking: (text) => {
              if (!isThinking) {
                isThinking = true;
                callbacks.onThinkingStart?.();
              }
              reasoning += text;
              callbacks.onReasoning?.(text);
            },
            onToolUseStart: (blockIndex, toolId, toolName) => {
              const tcIdx = toolCalls.length;
              toolCalls.push({
                id: toolId,
                type: 'function',
                function: { name: toolName, arguments: '' },
              });
              activeBlocks.set(blockIndex, { type: 'tool_use', toolCallIdx: tcIdx });
            },
            onToolUseDelta: (blockIndex, jsonDelta) => {
              const block = activeBlocks.get(blockIndex);
              if (block && block.type === 'tool_use') {
                toolCalls[block.toolCallIdx].function.arguments += jsonDelta;
                callbacks.onToolCallDelta?.(block.toolCallIdx, { arguments: jsonDelta });
              }
            },
            onUsage: (usage) => {
              this.totalUsage = accumulateUsage(this.totalUsage, usage);
              callbacks.onUsage?.(this.totalUsage);
            },
          });
        }
      } catch (error) {
        if (isThinking) callbacks.onThinkingEnd?.();
        await globalHooks.trigger('on-error', { error: error instanceof Error ? error : new Error(String(error)) });
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        break;
      }

      if (isThinking) callbacks.onThinkingEnd?.();

      // Issue #59: 重复循环检测 - 截断重复内容
      if (repetitionCount >= REPETITION_THRESHOLD) {
        // 去掉重复的尾部
        const uniqueChunks: string[] = [];
        for (const chunk of recentChunks) {
          if (uniqueChunks.length > 0 && chunk === uniqueChunks[uniqueChunks.length - 1]) continue;
          uniqueChunks.push(chunk);
        }
        content = content.slice(0, content.length - recentChunks.slice(-REPETITION_THRESHOLD * 2).join('').length);
        if (!content) content = '(模型输出重复，已自动截断)';
        log('warn', '已截断重复内容');
      }

      // Build assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: content || null,
      };

      const validToolCalls = toolCalls.filter(tc => tc.function.name);
      if (validToolCalls.length > 0) {
        assistantMsg.tool_calls = validToolCalls;
      }

      this.messages.push(assistantMsg);

      // === MiMo 自修复: 空响应处理 ===
      if (validToolCalls.length === 0 && !content.trim()) {
        consecutiveEmptyResponses++;
        if (consecutiveEmptyResponses >= 2) {
          log('warn', `MiMo 连续 ${consecutiveEmptyResponses} 次空响应，注入引导`);
          this.messages.push({
            role: 'user',
            content: '[系统] 你没有回复任何内容也没有调用工具。请根据用户的需求使用工具完成任务。如果不确定怎么做，先用 codebase 或 read_file 了解情况。',
          });
          continue;
        }
      } else {
        consecutiveEmptyResponses = 0;
      }

      // If no tool calls, we're done
      if (validToolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const toolGroups = this.groupToolCalls(validToolCalls);
      let batchErrors = 0;
      let batchSuccess = 0;

      for (const group of toolGroups) {
        if (group.parallel) {
          // Execute read-only tools in parallel
          const promises = group.calls.map(async (tc, groupIdx) => {
            const globalIdx = group.startIndex + groupIdx;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(repairJson(tc.function.arguments || '{}'));
            } catch {
              args = {};
            }
            return this.executeSingleTool(tc, args, mode, callbacks);
          });

          const results = await Promise.all(promises);
          for (const { error, success } of results) {
            if (!success) batchErrors++;
            else batchSuccess++;
          }
        } else {
          // Execute write tools sequentially
          for (const tc of group.calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(repairJson(tc.function.arguments || '{}'));
            } catch {
              args = {};
            }
            const { error, success } = await this.executeSingleTool(tc, args, mode, callbacks);
            if (!success) batchErrors++;
            else batchSuccess++;
          }
        }
      }

      // === MiMo 自修复: 连续工具错误处理 ===
      if (batchErrors > 0 && batchSuccess === 0) {
        consecutiveToolErrors++;
        if (consecutiveToolErrors >= 2) {
          log('warn', `MiMo 连续 ${consecutiveToolErrors} 轮工具调用全部失败`);
          this.messages.push({
            role: 'user',
            content: '[系统] 你的工具调用连续失败。请仔细阅读上面每条错误信息中的"修复"提示，按提示操作。常见修复方式：1) 用 glob 搜索正确文件路径 2) 用 read_file 重新读取文件内容 3) 增加 old_string 的上下文使其唯一。',
          });
          consecutiveToolErrors = 0;
          continue;
        }
      } else {
        consecutiveToolErrors = 0;
      }

      monitor.endTimer('iteration');
    }

    await globalHooks.trigger('post-response', { messages: this.messages });
    return { messages: this.messages, usage: this.totalUsage };
  }

  /**
   * Handle a single unified streaming event.
   */
  private handleStreamEvent(
    event: StreamEvent,
    handlers: {
      onText: (text: string) => void;
      onThinking: (text: string) => void;
      onToolUseStart: (blockIndex: number, toolId: string, toolName: string) => void;
      onToolUseDelta: (blockIndex: number, jsonDelta: string) => void;
      onUsage: (usage: TokenUsage) => void;
    },
  ): void {
    switch (event.type) {
      case 'text':
        if (event.text) handlers.onText(event.text);
        break;
      case 'thinking':
        if (event.thinking) handlers.onThinking(event.thinking);
        break;
      case 'tool_use_start':
        if (event.toolId && event.toolName) {
          handlers.onToolUseStart(this.toolCallIndex++, event.toolId, event.toolName);
        }
        break;
      case 'tool_use_delta':
        if (event.toolArgsDelta) {
          handlers.onToolUseDelta(this.toolCallIndex - 1, event.toolArgsDelta);
        }
        break;
      case 'usage':
        if (event.usage) handlers.onUsage(event.usage);
        break;
      case 'error':
        if (event.error) log('error', 'Stream error', event.error);
        break;
    }
  }

  private getToolsForMode(mode: AgentMode) {
    const allDefs = this.tools.getDefinitions();
    if (mode === 'plan') {
      return allDefs.filter(d => isToolAllowedInMode(mode, d.function.name));
    }
    return allDefs;
  }

  /**
   * Execute a single tool call with full validation, approval, hooks, and error enhancement.
   * Used by both parallel and sequential execution paths to avoid duplication.
   */
  private async executeSingleTool(
    tc: ToolCall,
    args: Record<string, unknown>,
    mode: AgentMode,
    callbacks: AgentLoopCallbacks,
  ): Promise<{ tc: ToolCall; error?: string; success: boolean }> {
    // Validation
    if (!isToolAllowedInMode(mode, tc.function.name)) {
      return { tc, error: `在 ${mode} 模式下不可用`, success: false };
    }

    const validation = this.validateToolCall(tc.function.name, args);
    if (!validation.valid) {
      return { tc, error: validation.error, success: false };
    }
    args = validation.args;

    // edit_file pre-check
    if (tc.function.name === 'edit_file' && args.path && !this.filesReadThisTurn.has(String(args.path))) {
      return { tc, error: `错误: 你还没有读取文件 "${args.path}"。请先用 read_file 读取。`, success: false };
    }

    // Approval check for write tools
    if (needsApproval(mode, tc.function.name) && callbacks.requestApproval) {
      const approved = await callbacks.requestApproval(tc.function.name, args);
      if (!approved) {
        return { tc, error: '已被用户拒绝', success: false };
      }
    }

    callbacks.onToolStart?.(tc.function.name, args);

    // Execute with hooks
    await globalHooks.trigger('pre-tool-execute', { toolName: tc.function.name, args });
    const result = await this.executeWithRetry(tc.function.name, args);
    await globalHooks.trigger('post-tool-execute', {
      toolName: tc.function.name,
      args,
      result: result.output,
      error: result.error ? new Error(result.error) : undefined,
    });

    // Track read files
    if (tc.function.name === 'read_file' && args.path && !result.error) {
      this.filesReadThisTurn.add(String(args.path));
    }

    result.tool_call_id = tc.id;
    const content = result.error ? this.enhanceToolError(tc.function.name, result.error, args) : result.output;
    const toolMsg: Message = {
      role: 'tool',
      content,
      tool_call_id: tc.id,
      name: tc.function.name,
    };
    this.messages.push(toolMsg);
    callbacks.onToolResult?.(tc.function.name, result.output, result.error);

    return { tc, error: result.error, success: !result.error };
  }

  /**
   * Group tool calls into batches: consecutive read-only tools form a parallel group,
   * write tools are each their own sequential group.
   */
  private groupToolCalls(toolCalls: ToolCall[]): Array<{
    parallel: boolean;
    calls: ToolCall[];
    startIndex: number;
  }> {
    const groups: Array<{ parallel: boolean; calls: ToolCall[]; startIndex: number }> = [];
    let i = 0;
    while (i < toolCalls.length) {
      const name = toolCalls[i].function.name;
      if (isReadOnlyTool(name)) {
        // Collect consecutive read-only tools
        const start = i;
        const calls: ToolCall[] = [];
        while (i < toolCalls.length && isReadOnlyTool(toolCalls[i].function.name)) {
          calls.push(toolCalls[i]);
          i++;
        }
        groups.push({ parallel: true, calls, startIndex: start });
      } else {
        // Each write tool is its own sequential group
        groups.push({ parallel: false, calls: [toolCalls[i]], startIndex: i });
        i++;
      }
    }
    return groups;
  }

  /**
   * Execute a tool with retry logic for transient errors.
   * Retries up to 2 times on transient failures.
   */
  private async executeWithRetry(
    name: string,
    args: Record<string, unknown>,
    maxRetries = 2,
  ): Promise<{ output: string; error?: string; tool_call_id?: string }> {
    monitor.startTimer(`tool:${name}`);
    let lastError: { output: string; error?: string; tool_call_id?: string } | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.tools.execute(name, args, this.toolContext);
      if (!result.error) {
        monitor.endTimer(`tool:${name}`);
        return result;
      }
      lastError = result;
      if (attempt < maxRetries && this.isTransientError(result.error)) {
        log('warn', `Tool "${name}" failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying: ${result.error}`);
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      } else {
        monitor.endTimer(`tool:${name}`);
        return result;
      }
    }
    monitor.endTimer(`tool:${name}`);
    return lastError!;
  }

  /**
   * Determine if an error is transient and worth retrying.
   */
  private isTransientError(error: string): boolean {
    const transientPatterns = [
      'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND',
      'rate limit', 'timeout', 'EPIPE', 'socket hang up',
      'network', 'temporarily unavailable', '503', '429',
    ];
    const lower = error.toLowerCase();
    return transientPatterns.some(pattern => lower.includes(pattern));
  }

  /**
   * MiMo 工具调用验证层: 在执行前拦截、验证、修复 MiMo 的工具调用
   * 返回 { valid, args, error } — valid=false 时直接返回 error 给 MiMo
   */
  private validateToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): { valid: boolean; args: Record<string, unknown>; error?: string } {
    // 1. 空参数修复
    if (!args || Object.keys(args).length === 0) {
      if (toolName === 'edit_file' || toolName === 'write_file' || toolName === 'read_file') {
        return { valid: false, args, error: `错误: ${toolName} 需要参数。示例: {"path": "文件路径", ...}` };
      }
    }

    // 2. edit_file 验证
    if (toolName === 'edit_file') {
      if (!args.path) return { valid: false, args, error: '错误: edit_file 缺少 path 参数' };
      if (!args.old_string && args.old_string !== '') return { valid: false, args, error: '错误: edit_file 缺少 old_string 参数。必须先 read_file 读取文件，然后从结果中复制 old_string。' };
      if (args.old_string === args.new_string) return { valid: false, args, error: '错误: old_string 和 new_string 相同，没有实际修改。' };
      // 检查 old_string 是否看起来像是从文件中复制的（至少 10 个字符）
      if (typeof args.old_string === 'string' && args.old_string.trim().length < 3) {
        return { valid: false, args, error: '错误: old_string 太短（<3字符），可能不唯一。请从 read_file 结果中复制更多上下文。' };
      }
    }

    // 3. write_file 验证
    if (toolName === 'write_file') {
      if (!args.path) return { valid: false, args, error: '错误: write_file 缺少 path 参数' };
      if (!args.content && args.content !== '') return { valid: false, args, error: '错误: write_file 缺少 content 参数' };
    }

    // 4. read_file 验证
    if (toolName === 'read_file') {
      if (!args.path) return { valid: false, args, error: '错误: read_file 缺少 path 参数' };
    }

    // 5. shell 验证
    if (toolName === 'shell') {
      if (!args.command) return { valid: false, args, error: '错误: shell 缺少 command 参数' };
      // 拦截危险命令
      const cmd = String(args.command).toLowerCase();
      if (cmd.includes('rm -rf /') || cmd.includes('rm -rf /*') || cmd.includes('format c:')) {
        return { valid: false, args, error: '错误: 危险命令已被拦截。不要执行删除根目录或格式化磁盘的命令。' };
      }
    }

    // 6. glob/grep 验证
    if (toolName === 'glob' && !args.pattern) return { valid: false, args, error: '错误: glob 缺少 pattern 参数' };
    if (toolName === 'grep' && !args.pattern) return { valid: false, args, error: '错误: grep 缺少 pattern 参数' };

    return { valid: true, args };
  }

  /**
   * 已读取文件跟踪: 确保 edit_file 之前 read_file 过该文件
   */
  private filesReadThisTurn = new Set<string>();

  /**
   * MiMo 自修复: 增强工具错误信息，帮助 MiMo 纠正
   */
  private enhanceToolError(toolName: string, error: string, args: Record<string, unknown>): string {
    const enhanced: string[] = [`错误: ${error}`];

    if (error.includes('File not found') || error.includes('ENOENT')) {
      enhanced.push(`修复: 用 glob 工具搜索正确路径。示例: {"pattern": "**/*${String(args.path || '').split('/').pop() || ''}*"}`);
    }

    if (error.includes('String not found') || error.includes('not found in file')) {
      enhanced.push(`修复: 先用 read_file 读取文件最新内容，然后从结果中精确复制 old_string。不要凭记忆写 old_string。`);
    }

    if (error.includes('Found') && error.includes('occurrences')) {
      enhanced.push(`修复: old_string 匹配了多处。增加前后几行上下文使其唯一。`);
    }

    if (error.includes('Access denied')) {
      enhanced.push(`修复: 文件在项目目录外。用相对路径或检查路径是否正确。`);
    }

    return enhanced.join('\n');
  }

  get currentUsage(): TokenUsage {
    return this.totalUsage;
  }

  abort(): void {
    this.client.abort();
  }
}

/**
 * 重复循环检测 (Issue #59)
 * 检查最近的文本块是否在重复同一模式
 */
function detectRepetition(chunks: string[], threshold: number): boolean {
  if (chunks.length < 10) return false;

  // 检查最近 N 个 chunk 是否完全相同
  const last = chunks[chunks.length - 1];
  if (!last || last.length < 3) return false;

  let repeatCount = 0;
  for (let i = chunks.length - 2; i >= Math.max(0, chunks.length - threshold * 2); i--) {
    if (chunks[i] === last) repeatCount++;
    else break;
  }

  return repeatCount >= threshold;
}
