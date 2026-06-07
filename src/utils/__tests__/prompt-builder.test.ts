// src/utils/__tests__/prompt-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, extractRecentErrors } from '../prompt-builder.js';
import type { Config } from '../../config.js';
import type { ProjectContext } from '../context.js';

const defaultConfig: Config = {
  provider: {
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com',
    model: 'mimo-test',
    providerType: 'auto',
  },
  agent: {
    mode: 'agent',
    maxIterations: 32,
    autoApproveReads: true,
    thinkingEnabled: false,
    reasoningEffort: 'medium',
  },
  ui: {
    theme: 'dark',
    showThinking: false,
    showTokens: false,
    compactMode: false,
    locale: 'zh',
  },
  mcp: { servers: [] },
};

function makeProjectCtx(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    fileTree: 'file: index.ts\nfile: app.ts',
    packageInfo: 'test-pkg',
    tsConfig: '',
    changedFiles: [],
    readmeSummary: '',
    ...overrides,
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectCtx: null as ProjectContext | null,
    config: defaultConfig,
    mode: 'agent',
    messageCount: 0,
    toolCallCount: 0,
    recentErrors: [],
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('includes core identity section', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('MiMo');
    expect(prompt).toContain('终端 AI 编程助手');
  });

  it('includes absolute rules', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('修改文件前必须先 read_file');
    expect(prompt).toContain('不要编造不存在的代码');
  });

  it('includes project context when provided', () => {
    const projectCtx = makeProjectCtx({
      packageInfo: '依赖: react, typescript\n脚本:\n  test: vitest',
      changedFiles: ['src/app.ts', 'src/index.ts'],
    });
    const prompt = buildSystemPrompt(makeInput({ projectCtx }));
    expect(prompt).toContain('项目信息');
    expect(prompt).toContain('src/app.ts');
  });

  it('detects React project type', () => {
    const projectCtx = makeProjectCtx({
      packageInfo: '依赖: react\n脚本:\n  dev: next dev',
    });
    const prompt = buildSystemPrompt(makeInput({ projectCtx }));
    expect(prompt).toContain('React/Next.js');
  });

  it('detects TypeScript project type', () => {
    const projectCtx = makeProjectCtx({
      packageInfo: '依赖: typescript',
    });
    const prompt = buildSystemPrompt(makeInput({ projectCtx }));
    expect(prompt).toContain('TypeScript');
  });

  it('detects testing framework', () => {
    const projectCtx = makeProjectCtx({
      packageInfo: '开发依赖: vitest',
    });
    const prompt = buildSystemPrompt(makeInput({ projectCtx }));
    expect(prompt).toContain('测试框架');
  });

  it('includes available scripts from packageInfo', () => {
    const projectCtx = makeProjectCtx({
      packageInfo: '脚本:\n  test: vitest\n  build: tsc',
    });
    const prompt = buildSystemPrompt(makeInput({ projectCtx }));
    expect(prompt).toContain('test: vitest');
  });

  it('includes error history when present', () => {
    const recentErrors = ['错误: 文件未找到', '错误: 类型不匹配'];
    const prompt = buildSystemPrompt(makeInput({ recentErrors }));
    expect(prompt).toContain('近期错误提醒');
    expect(prompt).toContain('文件未找到');
    expect(prompt).toContain('类型不匹配');
  });

  it('includes task analysis when userMessage is provided', () => {
    const prompt = buildSystemPrompt(makeInput({
      userMessage: '修复 app.ts 中的 bug',
    }));
    expect(prompt).toContain('任务类型');
    expect(prompt).toContain('Bug 修复');
  });

  it('does not include task analysis when no userMessage', () => {
    const prompt = buildSystemPrompt(makeInput({ userMessage: undefined }));
    // Should not crash and should not have task analysis section
    expect(prompt).toContain('MiMo');
  });

  describe('modes', () => {
    it('includes plan mode instructions', () => {
      const prompt = buildSystemPrompt(makeInput({ mode: 'plan' }));
      expect(prompt).toContain('计划（只读）');
      expect(prompt).toContain('不能修改');
    });

    it('includes yolo/auto mode instructions', () => {
      const prompt = buildSystemPrompt(makeInput({ mode: 'yolo' }));
      expect(prompt).toContain('自动');
      expect(prompt).toContain('不需要用户确认');
    });

    it('does not add mode section for agent mode', () => {
      const prompt = buildSystemPrompt(makeInput({ mode: 'agent' }));
      expect(prompt).not.toContain('当前模式: 计划');
      expect(prompt).not.toContain('当前模式: 自动');
    });
  });

  it('includes long conversation warning when messageCount > 20', () => {
    const prompt = buildSystemPrompt(makeInput({ messageCount: 25 }));
    expect(prompt).toContain('对话较长');
    expect(prompt).toContain('25');
  });

  it('does not include long conversation warning for small messageCount', () => {
    const prompt = buildSystemPrompt(makeInput({ messageCount: 5 }));
    expect(prompt).not.toContain('对话较长');
  });

  it('includes tool usage guidelines', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('edit_file');
    expect(prompt).toContain('shell');
    expect(prompt).toContain('glob');
  });

  it('includes reply style section', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('回复规范');
    expect(prompt).toContain('中文');
  });

  it('handles null projectCtx gracefully', () => {
    const prompt = buildSystemPrompt(makeInput({ projectCtx: null }));
    expect(prompt).toContain('MiMo');
    expect(prompt).not.toContain('项目信息');
  });

  it('does not include error section when no recent errors', () => {
    const prompt = buildSystemPrompt(makeInput({ recentErrors: [] }));
    expect(prompt).not.toContain('近期错误提醒');
  });

  it('includes changed files in project context', () => {
    const projectCtx = makeProjectCtx({
      changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
    const prompt = buildSystemPrompt(makeInput({ projectCtx }));
    expect(prompt).toContain('最近变更');
    expect(prompt).toContain('src/a.ts');
  });
});

describe('extractRecentErrors', () => {
  it('extracts error messages from tool role messages', () => {
    const messages = [
      { role: 'user', content: 'fix the bug' },
      { role: 'tool', content: '错误: 文件未找到 src/app.ts' },
      { role: 'assistant', content: 'I will fix it' },
      { role: 'tool', content: '错误: old_string 不匹配' },
    ];
    const errors = extractRecentErrors(messages);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('文件未找到');
    expect(errors[1]).toContain('old_string 不匹配');
  });

  it('returns empty array when no errors', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'tool', content: 'success' },
    ];
    const errors = extractRecentErrors(messages);
    expect(errors).toEqual([]);
  });

  it('returns at most 3 errors', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'tool' as const,
      content: `错误: error ${i}`,
    }));
    const errors = extractRecentErrors(messages);
    expect(errors).toHaveLength(3);
  });

  it('deduplicates identical error messages', () => {
    const messages = [
      { role: 'tool' as const, content: '错误: same error' },
      { role: 'tool' as const, content: '错误: same error' },
      { role: 'tool' as const, content: '错误: different error' },
    ];
    const errors = extractRecentErrors(messages);
    expect(errors).toHaveLength(2);
  });

  it('handles null content gracefully', () => {
    const messages = [
      { role: 'tool' as const, content: null },
      { role: 'tool' as const, content: '错误: real error' },
    ];
    const errors = extractRecentErrors(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('real error');
  });

  it('truncates error line to 100 characters', () => {
    const longError = '错误: ' + 'x'.repeat(200);
    const messages = [{ role: 'tool' as const, content: longError }];
    const errors = extractRecentErrors(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.length).toBeLessThanOrEqual(100);
  });
});
