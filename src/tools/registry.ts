// src/tools/registry.ts - Tool registry & dispatcher

import type { ToolDefinition, ToolResult } from '../api/types.js';
import type { Sandbox } from '../utils/sandbox.js';

export interface ToolContext {
  sandbox: Sandbox;
  cwd: string;
  workingDirectory: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  requiresApproval?: boolean;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private definitionsCache: ToolDefinition[] | null = null;

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.definitionsCache = null; // invalidate cache
  }

  getDefinitions(): ToolDefinition[] {
    if (!this.definitionsCache) {
      this.definitionsCache = Array.from(this.tools.values()).map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }
    return this.definitionsCache;
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        tool_call_id: '',
        name,
        output: '',
        error: `未知工具: ${name}`,
      };
    }

    try {
      const output = await tool.execute(args, ctx);
      return {
        tool_call_id: '',
        name,
        output,
      };
    } catch (error) {
      return {
        tool_call_id: '',
        name,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  get requiresApproval(): string[] {
    return Array.from(this.tools.values())
      .filter(t => t.requiresApproval !== false)
      .map(t => t.name);
  }

  get allToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
