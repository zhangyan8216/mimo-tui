// src/tools/todo.ts - Task/todo management

import type { Tool, ToolContext } from './registry.js';

interface TodoItem {
  id: number;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

let todos: TodoItem[] = [];
let nextId = 1;

export const todoTool: Tool = {
  name: 'todo',
  description: '管理当前会话的任务列表。适合拆分复杂任务为多个步骤，跟踪进度。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'update', 'list', 'clear'],
        description: '操作类型: add(添加), update(更新状态), list(列出所有), clear(清空)',
      },
      content: {
        type: 'string',
        description: '任务描述（add 时必填）。示例: "修复登录页面的验证逻辑"',
      },
      id: {
        type: 'number',
        description: 'Task ID (for update action)',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'New status (for update action)',
      },
    },
    required: ['action'],
  },
  requiresApproval: false,
  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(args.action);

    switch (action) {
      case 'add': {
        const content = String(args.content || '');
        if (!content) throw new Error('添加任务时内容不能为空');
        const todo: TodoItem = { id: nextId++, content, status: 'pending' };
        todos.push(todo);
        return `已添加任务 #${todo.id}: ${content}`;
      }

      case 'update': {
        const id = Number(args.id);
        const todo = todos.find(t => t.id === id);
        if (!todo) throw new Error(`任务 #${id} 未找到`);
        if (args.status != null) {
          const status = String(args.status) as TodoItem['status'];
          const validStatuses: TodoItem['status'][] = ['pending', 'in_progress', 'completed'];
          if (!validStatuses.includes(status)) {
            throw new Error(`无效状态 "${status}"。有效值: ${validStatuses.join(', ')}`);
          }
          todo.status = status;
        }
        return `已更新任务 #${id}: ${todo.status}`;
      }

      case 'list': {
        if (todos.length === 0) return '暂无任务。';
        return todos.map(t => {
          const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
          return `${icon} #${t.id} [${t.status}] ${t.content}`;
        }).join('\n');
      }

      case 'clear': {
        const count = todos.length;
        todos = [];
        nextId = 1;
        return `已清空 ${count} 个任务。`;
      }

      default:
        throw new Error(`未知操作: ${action}`);
    }
  },
};

export function resetTodos(): void {
  todos = [];
  nextId = 1;
}
