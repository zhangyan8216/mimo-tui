// src/utils/workflow.ts - 工作流引擎（链式操作）

import type { Message } from '../api/types.js';

export interface WorkflowStep {
  id: string;
  name: string;
  prompt: string;
  autoApprove?: boolean;
  condition?: 'always' | 'onSuccess' | 'onFailure';
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  triggers?: string[];
}

/** 内置工作流 */
export const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    id: 'full-review',
    name: '全面代码审查',
    description: '审查代码质量、安全性、性能，生成报告',
    steps: [
      { id: 'scan', name: '扫描代码', prompt: '请扫描当前项目的主要源代码文件，列出所有源文件路径和简要功能描述。' },
      { id: 'review', name: '审查代码', prompt: '请对以上文件进行代码审查，关注：1) Bug 风险 2) 安全漏洞 3) 性能问题 4) 代码风格。每项给出具体文件和行号。' },
      { id: 'report', name: '生成报告', prompt: '请根据以上审查结果，生成一份结构化的代码审查报告，按严重程度排序，包含修复建议。' },
    ],
  },
  {
    id: 'test-gen',
    name: '测试生成工作流',
    description: '分析代码并生成完整测试套件',
    steps: [
      { id: 'analyze', name: '分析代码', prompt: '请分析当前项目的核心模块，识别需要测试的关键函数和类。' },
      { id: 'unit', name: '生成单元测试', prompt: '请为以上识别的核心模块生成单元测试，覆盖正常路径、边界条件和错误处理。' },
      { id: 'verify', name: '验证测试', prompt: '请运行生成的测试，修复失败的测试用例。' },
    ],
  },
  {
    id: 'refactor-flow',
    name: '重构工作流',
    description: '分析 → 计划 → 重构 → 验证',
    steps: [
      { id: 'analyze', name: '分析代码', prompt: '请分析当前代码的架构和设计模式，识别需要重构的热点区域。' },
      { id: 'plan', name: '制定计划', prompt: '请根据分析结果制定详细的重构计划，包括优先级和预期影响。' },
      { id: 'refactor', name: '执行重构', prompt: '请按照计划执行重构，每次修改后确保代码仍然可以编译通过。' },
      { id: 'test', name: '验证重构', prompt: '请运行测试确保重构没有引入回归问题。' },
    ],
  },
  {
    id: 'git-flow',
    name: 'Git 提交工作流',
    description: '查看更改 → 审查 → 生成提交信息 → 提交',
    steps: [
      { id: 'status', name: '查看状态', prompt: '请执行 git status 和 git diff 查看当前所有更改。' },
      { id: 'review', name: '审查更改', prompt: '请审查以上更改，确认没有意外的修改或敏感信息泄露。' },
      { id: 'commit', name: '生成提交', prompt: '请根据以上更改生成规范的 Conventional Commits 格式提交信息，并执行 git add 和 git commit。' },
    ],
  },
  {
    id: 'debug-flow',
    name: '调试工作流',
    description: '复现 → 分析 → 修复 → 验证',
    steps: [
      { id: 'reproduce', name: '复现问题', prompt: '请帮我复现这个错误，运行相关命令并收集错误信息。' },
      { id: 'analyze', name: '分析原因', prompt: '请分析错误的根本原因，查看相关源代码和日志。' },
      { id: 'fix', name: '修复问题', prompt: '请修复这个错误，并解释修复方案。' },
      { id: 'verify', name: '验证修复', prompt: '请运行测试验证修复是否有效，没有引入新问题。' },
    ],
  },
];

export function searchWorkflows(query: string): Workflow[] {
  const lower = query.toLowerCase();
  return BUILTIN_WORKFLOWS.filter(w =>
    w.name.toLowerCase().includes(lower) ||
    w.description.toLowerCase().includes(lower)
  );
}
