// src/utils/templates.ts - 对话模板（预设提示词）

export interface Template {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category: string;
  icon: string;
}

export const TEMPLATES: Template[] = [
  // 代码审查
  {
    id: 'review',
    name: '代码审查',
    description: '审查指定文件的代码质量',
    prompt: '请审查以下代码，关注：\n1. 潜在的 bug\n2. 性能问题\n3. 安全漏洞\n4. 代码风格\n5. 可读性改进建议\n\n文件: ',
    category: '代码',
    icon: '🔍',
  },
  {
    id: 'refactor',
    name: '重构建议',
    description: '分析代码并给出重构建议',
    prompt: '请分析这段代码并给出重构建议：\n1. 提取可复用函数\n2. 简化逻辑\n3. 改善命名\n4. 减少嵌套\n\n代码: ',
    category: '代码',
    icon: '🔧',
  },
  {
    id: 'test',
    name: '生成测试',
    description: '为指定代码生成单元测试',
    prompt: '请为以下代码生成完整的单元测试，覆盖：\n1. 正常路径\n2. 边界条件\n3. 错误处理\n4. 使用 Jest/Vitest 格式\n\n代码: ',
    category: '代码',
    icon: '🧪',
  },
  {
    id: 'explain',
    name: '解释代码',
    description: '详细解释代码的工作原理',
    prompt: '请详细解释以下代码：\n1. 整体功能\n2. 关键逻辑流程\n3. 重要变量和函数的作用\n4. 潜在的注意事项\n\n代码: ',
    category: '代码',
    icon: '📖',
  },
  {
    id: 'fix',
    name: '修复错误',
    description: '分析错误并提供修复方案',
    prompt: '请分析以下错误并提供修复方案：\n1. 错误原因\n2. 修复代码\n3. 预防措施\n\n错误信息: ',
    category: '调试',
    icon: '🐛',
  },
  {
    id: 'optimize',
    name: '性能优化',
    description: '分析并优化代码性能',
    prompt: '请分析以下代码的性能瓶颈并给出优化方案：\n1. 时间复杂度分析\n2. 空间复杂度分析\n3. 具体优化建议\n4. 优化后的代码\n\n代码: ',
    category: '性能',
    icon: '⚡',
  },
  {
    id: 'docs',
    name: '生成文档',
    description: '为代码生成文档注释',
    prompt: '请为以下代码生成完整的文档：\n1. 函数/类说明\n2. 参数说明\n3. 返回值说明\n4. 使用示例\n5. 注意事项\n\n代码: ',
    category: '文档',
    icon: '📝',
  },
  {
    id: 'api',
    name: '设计 API',
    description: '设计 RESTful API',
    prompt: '请为以下需求设计 RESTful API：\n1. 端点设计\n2. 请求/响应格式\n3. 状态码\n4. 认证方案\n5. 错误处理\n\n需求: ',
    category: '设计',
    icon: '🌐',
  },
  {
    id: 'db',
    name: '数据库设计',
    description: '设计数据库 schema',
    prompt: '请为以下需求设计数据库 schema：\n1. 表结构\n2. 字段类型\n3. 索引\n4. 关系\n5. 迁移脚本\n\n需求: ',
    category: '设计',
    icon: '🗄️',
  },
  {
    id: 'debug',
    name: '系统调试',
    description: '分析系统问题',
    prompt: '请帮我排查以下问题：\n1. 可能的原因\n2. 排查步骤\n3. 修复方案\n\n问题描述: ',
    category: '调试',
    icon: '🔍',
  },
  {
    id: 'git-commit',
    name: '生成提交信息',
    description: '根据更改生成 Git 提交信息',
    prompt: '请根据以下更改生成规范的 Git 提交信息 (Conventional Commits 格式):\n\ngit diff: ',
    category: 'Git',
    icon: '📦',
  },
  {
    id: 'changelog',
    name: '生成更新日志',
    description: '根据提交历史生成更新日志',
    prompt: '请根据以下 Git 提交历史生成格式化的更新日志 (Keep a Changelog 格式):\n\n提交记录: ',
    category: 'Git',
    icon: '📋',
  },
];

export function getTemplatesByCategory(): Map<string, Template[]> {
  const map = new Map<string, Template[]>();
  for (const t of TEMPLATES) {
    const existing = map.get(t.category) || [];
    existing.push(t);
    map.set(t.category, existing);
  }
  return map;
}

export function searchTemplates(query: string): Template[] {
  const lower = query.toLowerCase();
  return TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(lower) ||
    t.description.toLowerCase().includes(lower) ||
    t.category.toLowerCase().includes(lower)
  );
}
