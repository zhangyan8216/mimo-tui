// src/utils/task-planner.ts - 智能任务规划器
// 分析用户请求，自动拆解为可执行的步骤，注入到系统提示词

interface TaskStep {
  id: number;
  action: string;        // read_file / edit_file / shell / codebase / test_runner
  target: string;        // 文件路径或命令
  description: string;   // 这步要做什么
  dependsOn?: number[];  // 依赖的步骤 id
}

interface TaskPlan {
  goal: string;
  steps: TaskStep[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
}

/**
 * 分析用户消息，判断任务类型并生成规划建议
 * 返回注入到系统提示词中的规划指导
 */
export function analyzeTask(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  const parts: string[] = [];

  // 检测任务类型
  const taskType = detectTaskType(lower);
  if (taskType) {
    parts.push(`## 任务类型: ${taskType.name}`);
    parts.push(taskType.workflow);
  }

  // 检测涉及的文件
  const fileRefs = userMessage.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|json|md)/g);
  if (fileRefs && fileRefs.length > 0) {
    parts.push(`## 涉及文件\n用户提到了这些文件，请优先读取和理解:\n${fileRefs.map(f => `- ${f}`).join('\n')}`);
  }

  // 检测复杂度
  const complexity = estimateComplexity(userMessage);
  if (complexity === 'complex') {
    parts.push(`## 任务较复杂
建议用 todo 工具拆分为多个步骤，每完成一步标记 completed。不要试图一次做完所有事。`);
  }

  return parts.join('\n\n');
}

interface TaskTypeInfo {
  name: string;
  workflow: string;
}

function detectTaskType(message: string): TaskTypeInfo | null {
  const lower = message.toLowerCase();
  const patterns: Array<{ keywords: string[]; type: TaskTypeInfo }> = [
    {
      keywords: ['修复', 'fix', 'bug', '报错', '错误', 'error', '不工作', '失败', 'crash'],
      type: {
        name: 'Bug 修复',
        workflow: `工作流程:
1. 用 codebase(action=index) 了解项目结构
2. 用 grep 搜索错误信息或相关关键词
3. 用 read_file 读取相关文件
4. 分析根因（不要猜测，要读代码确认）
5. 用 edit_file 修复
6. 用 test_runner 或 shell 编译验证`,
      },
    },
    {
      keywords: ['重构', 'refactor', '重写', '优化', 'improve', 'clean'],
      type: {
        name: '代码重构',
        workflow: `工作流程:
1. 用 codebase(action=deps) 了解影响范围
2. 用 read_file 读取要重构的文件
3. 用 todo 规划重构步骤
4. 逐步用 edit_file 修改
5. 每步修改后用 shell 编译验证
6. 用 test_runner 确保测试通过`,
      },
    },
    {
      keywords: ['添加', 'add', '新增', '实现', 'implement', '功能', 'feature'],
      type: {
        name: '功能开发',
        workflow: `工作流程:
1. 用 codebase(action=index) 了解项目结构
2. 用 codebase(action=symbols) 找到相关接口和类型
3. 用 todo 规划实现步骤
4. 创建新文件用 write_file
5. 修改现有文件用 edit_file（必须先 read_file）
6. 用 shell 编译验证
7. 用 test_runner 跑测试`,
      },
    },
    {
      keywords: ['测试', 'test', 'spec', '单测', '集成测试'],
      type: {
        name: '测试编写',
        workflow: `工作流程:
1. 用 read_file 读取要测试的源文件
2. 用 glob 查找现有测试文件的模式
3. 用 read_file 读取一个现有测试作为参考
4. 用 write_file 创建测试文件
5. 用 test_runner 运行测试验证`,
      },
    },
    {
      keywords: ['解释', 'explain', '分析', 'analyze', '理解', 'understand', '看看'],
      type: {
        name: '代码分析',
        workflow: `工作流程:
1. 用 codebase(action=index) 了解项目全貌
2. 用 read_file 读取相关文件
3. 用 codebase(action=deps) 查看依赖关系
4. 用 codebase(action=related) 找到关联文件
5. 给出结构化的分析结论`,
      },
    },
    {
      keywords: ['git', '提交', 'commit', '分支', 'branch', '合并', 'merge', 'rebase'],
      type: {
        name: 'Git 操作',
        workflow: `工作流程:
1. 用 shell 执行 git status 查看当前状态
2. 用 shell 执行 git diff 查看变更
3. 执行用户请求的 git 操作
4. 用 shell 验证操作结果`,
      },
    },
  ];

  for (const { keywords, type } of patterns) {
    if (keywords.some(k => lower.includes(k))) {
      return type;
    }
  }

  return null;
}

function estimateComplexity(message: string): 'simple' | 'medium' | 'complex' {
  const lower = message.toLowerCase();
  const indicators = {
    complex: ['所有', '整个', '全面', '系统性', '重构', '迁移', 'refactor', 'migrate'],
    medium: ['修改', '添加', '实现', 'fix', 'implement', 'update'],
    simple: ['查看', '读取', '搜索', 'show', 'read', 'find'],
  };

  if (indicators.complex.some(k => lower.includes(k))) return 'complex';
  if (indicators.medium.some(k => lower.includes(k))) return 'medium';
  return 'simple';
}
