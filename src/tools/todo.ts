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
  description: 'Manage a task/todo list for the current session. Supports add, update, list, and clear operations.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'update', 'list', 'clear'],
        description: 'The action to perform',
      },
      content: {
        type: 'string',
        description: 'Task content (for add action)',
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
        if (!content) throw new Error('Content is required for add action');
        const todo: TodoItem = { id: nextId++, content, status: 'pending' };
        todos.push(todo);
        return `Added task #${todo.id}: ${content}`;
      }

      case 'update': {
        const id = Number(args.id);
        const status = String(args.status) as TodoItem['status'];
        const todo = todos.find(t => t.id === id);
        if (!todo) throw new Error(`Task #${id} not found`);
        if (status) todo.status = status;
        return `Updated task #${id}: ${todo.status}`;
      }

      case 'list': {
        if (todos.length === 0) return 'No tasks.';
        return todos.map(t => {
          const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
          return `${icon} #${t.id} [${t.status}] ${t.content}`;
        }).join('\n');
      }

      case 'clear': {
        const count = todos.length;
        todos = [];
        nextId = 1;
        return `Cleared ${count} tasks.`;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
};

export function resetTodos(): void {
  todos = [];
  nextId = 1;
}
