// src/tools/__tests__/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../registry.js';
import type { Tool, ToolContext } from '../registry.js';

const mockCtx: ToolContext = {
  sandbox: {} as any,
  cwd: '/test',
  workingDirectory: '/test',
};

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => 'ok',
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('adds a tool', () => {
      registry.register(makeTool());
      expect(registry.allToolNames).toContain('test_tool');
    });

    it('overwrites existing tool with same name', () => {
      registry.register(makeTool({ description: 'first' }));
      registry.register(makeTool({ description: 'second' }));
      expect(registry.allToolNames).toHaveLength(1);
    });
  });

  describe('getDefinitions', () => {
    it('returns correct format', () => {
      registry.register(makeTool());
      const defs = registry.getDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0]).toEqual({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      });
    });

    it('returns empty array when no tools registered', () => {
      expect(registry.getDefinitions()).toEqual([]);
    });

    it('returns multiple definitions', () => {
      registry.register(makeTool({ name: 'tool_a' }));
      registry.register(makeTool({ name: 'tool_b' }));
      expect(registry.getDefinitions()).toHaveLength(2);
    });
  });

  describe('getTool', () => {
    it('returns tool by name', () => {
      const tool = makeTool();
      registry.register(tool);
      expect(registry.getTool('test_tool')).toBe(tool);
    });

    it('returns undefined for unknown tool', () => {
      expect(registry.getTool('nonexistent')).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('dispatches to correct tool', async () => {
      const execute = async (args: Record<string, unknown>) => `echo: ${args.input}`;
      registry.register(makeTool({ execute }));
      const result = await registry.execute('test_tool', { input: 'hello' }, mockCtx);
      expect(result.output).toBe('echo: hello');
      expect(result.error).toBeUndefined();
    });

    it('handles errors gracefully', async () => {
      const execute = async () => { throw new Error('boom'); };
      registry.register(makeTool({ execute }));
      const result = await registry.execute('test_tool', {}, mockCtx);
      expect(result.output).toBe('');
      expect(result.error).toBe('boom');
    });

    it('handles non-Error throws', async () => {
      const execute = async () => { throw 'string error'; };
      registry.register(makeTool({ execute }));
      const result = await registry.execute('test_tool', {}, mockCtx);
      expect(result.error).toBe('string error');
    });

    it('returns error for unknown tool', async () => {
      const result = await registry.execute('unknown', {}, mockCtx);
      expect(result.error).toBe('未知工具: unknown');
      expect(result.output).toBe('');
    });
  });

  describe('requiresApproval', () => {
    it('lists tools that require approval by default', () => {
      registry.register(makeTool({ name: 'a' }));
      registry.register(makeTool({ name: 'b', requiresApproval: false }));
      registry.register(makeTool({ name: 'c', requiresApproval: true }));
      const approval = registry.requiresApproval;
      expect(approval).toContain('a');
      expect(approval).not.toContain('b');
      expect(approval).toContain('c');
    });

    it('returns empty when no tools registered', () => {
      expect(registry.requiresApproval).toEqual([]);
    });
  });

  describe('allToolNames', () => {
    it('returns all registered tool names', () => {
      registry.register(makeTool({ name: 'alpha' }));
      registry.register(makeTool({ name: 'beta' }));
      expect(registry.allToolNames).toEqual(['alpha', 'beta']);
    });
  });
});
