// src/agent/__tests__/modes.test.ts
import { describe, it, expect } from 'vitest';
import {
  isToolAllowedInMode,
  needsApproval,
  isReadOnlyTool,
  getModeConfig,
  MODES,
} from '../modes.js';

describe('isToolAllowedInMode', () => {
  describe('plan mode', () => {
    it('allows read tools', () => {
      expect(isToolAllowedInMode('plan', 'read_file')).toBe(true);
      expect(isToolAllowedInMode('plan', 'glob')).toBe(true);
      expect(isToolAllowedInMode('plan', 'grep')).toBe(true);
    });

    it('blocks write_file', () => {
      expect(isToolAllowedInMode('plan', 'write_file')).toBe(false);
    });

    it('blocks edit_file', () => {
      expect(isToolAllowedInMode('plan', 'edit_file')).toBe(false);
    });

    it('blocks shell', () => {
      expect(isToolAllowedInMode('plan', 'shell')).toBe(false);
    });

    it('blocks web_fetch', () => {
      expect(isToolAllowedInMode('plan', 'web_fetch')).toBe(false);
    });

    it('allows unknown/MCP tools', () => {
      expect(isToolAllowedInMode('plan', 'custom_mcp_tool')).toBe(true);
    });
  });

  describe('agent mode', () => {
    it('allows all tools', () => {
      expect(isToolAllowedInMode('agent', 'read_file')).toBe(true);
      expect(isToolAllowedInMode('agent', 'write_file')).toBe(true);
      expect(isToolAllowedInMode('agent', 'shell')).toBe(true);
      expect(isToolAllowedInMode('agent', 'edit_file')).toBe(true);
    });
  });

  describe('yolo mode', () => {
    it('allows all tools', () => {
      expect(isToolAllowedInMode('yolo', 'read_file')).toBe(true);
      expect(isToolAllowedInMode('yolo', 'write_file')).toBe(true);
      expect(isToolAllowedInMode('yolo', 'shell')).toBe(true);
      expect(isToolAllowedInMode('yolo', 'web_fetch')).toBe(true);
    });
  });
});

describe('needsApproval', () => {
  describe('plan mode', () => {
    it('auto-approves reads', () => {
      expect(needsApproval('plan', 'read_file')).toBe(false);
      expect(needsApproval('plan', 'glob')).toBe(false);
      expect(needsApproval('plan', 'grep')).toBe(false);
    });

    it('requires approval for shell', () => {
      expect(needsApproval('plan', 'shell')).toBe(true);
    });

    it('requires approval for write tools', () => {
      expect(needsApproval('plan', 'write_file')).toBe(true);
      expect(needsApproval('plan', 'edit_file')).toBe(true);
    });

    it('does not require approval for unknown tools (blocked at mode level)', () => {
      // plan 模式下未知工具被 isToolAllowedInMode 拦截，不需要审批检查
      expect(needsApproval('plan', 'unknown_tool')).toBe(false);
    });
  });

  describe('agent mode', () => {
    it('auto-approves reads', () => {
      expect(needsApproval('agent', 'read_file')).toBe(false);
      expect(needsApproval('agent', 'glob')).toBe(false);
      expect(needsApproval('agent', 'grep')).toBe(false);
    });

    it('requires approval for shell', () => {
      expect(needsApproval('agent', 'shell')).toBe(true);
    });

    it('auto-approves write tools', () => {
      // agent 模式: 写操作自动批准
      expect(needsApproval('agent', 'write_file')).toBe(false);
      expect(needsApproval('agent', 'edit_file')).toBe(false);
      expect(needsApproval('agent', 'multi_edit')).toBe(false);
    });
  });

  describe('yolo mode', () => {
    it('auto-approves everything', () => {
      expect(needsApproval('yolo', 'read_file')).toBe(false);
      expect(needsApproval('yolo', 'glob')).toBe(false);
      expect(needsApproval('yolo', 'grep')).toBe(false);
      expect(needsApproval('yolo', 'shell')).toBe(false);
      expect(needsApproval('yolo', 'write_file')).toBe(false);
      expect(needsApproval('yolo', 'edit_file')).toBe(false);
      expect(needsApproval('yolo', 'web_fetch')).toBe(false);
    });

    it('does not require approval for unknown tools', () => {
      expect(needsApproval('yolo', 'custom_tool')).toBe(false);
    });
  });
});

describe('isReadOnlyTool', () => {
  it('identifies read_file as read-only', () => {
    expect(isReadOnlyTool('read_file')).toBe(true);
  });

  it('identifies glob as read-only', () => {
    expect(isReadOnlyTool('glob')).toBe(true);
  });

  it('identifies grep as read-only', () => {
    expect(isReadOnlyTool('grep')).toBe(true);
  });

  it('identifies todo as read-only', () => {
    expect(isReadOnlyTool('todo')).toBe(true);
  });

  it('does not identify write_file as read-only', () => {
    expect(isReadOnlyTool('write_file')).toBe(false);
  });

  it('does not identify shell as read-only', () => {
    expect(isReadOnlyTool('shell')).toBe(false);
  });

  it('does not identify unknown tools as read-only', () => {
    expect(isReadOnlyTool('custom_tool')).toBe(false);
  });
});

describe('getModeConfig', () => {
  it('returns plan config', () => {
    const config = getModeConfig('plan');
    expect(config.name).toBe('plan');
    expect(config.autoApproveReads).toBe(true);
    expect(config.autoApproveWrites).toBe(false);
    expect(config.autoApproveShell).toBe(false);
  });

  it('returns agent config', () => {
    const config = getModeConfig('agent');
    expect(config.name).toBe('agent');
    expect(config.autoApproveReads).toBe(true);
    expect(config.autoApproveWrites).toBe(true);
    expect(config.autoApproveShell).toBe(false);
  });

  it('returns yolo config', () => {
    const config = getModeConfig('yolo');
    expect(config.name).toBe('yolo');
    expect(config.autoApproveReads).toBe(true);
    expect(config.autoApproveWrites).toBe(true);
    expect(config.autoApproveShell).toBe(true);
  });
});

describe('MODES', () => {
  it('has all three modes defined', () => {
    expect(Object.keys(MODES)).toEqual(expect.arrayContaining(['plan', 'agent', 'yolo']));
  });

  it('each mode has required fields', () => {
    for (const mode of Object.values(MODES)) {
      expect(mode).toHaveProperty('name');
      expect(mode).toHaveProperty('icon');
      expect(mode).toHaveProperty('label');
      expect(mode).toHaveProperty('description');
      expect(mode).toHaveProperty('maxIterations');
    }
  });
});
