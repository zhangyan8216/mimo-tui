// src/plugins/__tests__/manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PluginManager } from '../manager.js';
import { ToolRegistry } from '../../tools/registry.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-plugins');

describe('PluginManager', () => {
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    toolRegistry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('discoverAndActivate with no plugins directory', () => {
    it('completes without error when .mimo/plugins does not exist', async () => {
      const manager = new PluginManager(toolRegistry);
      // cwd has no .mimo/plugins directory
      await expect(
        manager.discoverAndActivate(tmpDir, {
          provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
          agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
          ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
          mcp: { servers: [] },
        })
      ).resolves.toBeUndefined();

      expect(manager.activeCount).toBe(0);
      expect(manager.activePluginNames).toEqual([]);
    });

    it('completes without error when node_modules does not exist', async () => {
      const manager = new PluginManager(toolRegistry);
      await manager.discoverAndActivate(tmpDir, {
        provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
        agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
        ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
        mcp: { servers: [] },
      });
      expect(manager.activeCount).toBe(0);
    });
  });

  describe('hasCommand and executeCommand', () => {
    it('hasCommand returns false when no plugins are loaded', () => {
      const manager = new PluginManager(toolRegistry);
      expect(manager.hasCommand('test-cmd')).toBe(false);
    });

    it('executeCommand returns unknown message when no plugins are loaded', async () => {
      const manager = new PluginManager(toolRegistry);
      const result = await manager.executeCommand('test-cmd', []);
      expect(result).toBe('Unknown plugin command: test-cmd');
    });

    it('discovers and activates a local plugin with commands', async () => {
      // Set up a local plugin in .mimo/plugins/
      const pluginDir = path.join(tmpDir, '.mimo', 'plugins', 'test-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });

      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        main: 'index.js',
      }));

      fs.writeFileSync(path.join(pluginDir, 'index.js'), `
        module.exports = {
          manifest: { name: 'test-plugin', version: '1.0.0', description: 'A test plugin', main: 'index.js' },
          activate(ctx) {
            ctx.registerCommand('hello', async (args) => 'Hello ' + args.join(' '));
          },
        };
      `);

      const manager = new PluginManager(toolRegistry);
      await manager.discoverAndActivate(tmpDir, {
        provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
        agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
        ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
        mcp: { servers: [] },
      });

      expect(manager.activeCount).toBe(1);
      expect(manager.activePluginNames).toEqual(['test-plugin']);
      expect(manager.hasCommand('hello')).toBe(true);
      expect(manager.hasCommand('nonexistent')).toBe(false);

      const result = await manager.executeCommand('hello', ['world']);
      expect(result).toBe('Hello world');
    });

    it('discovers a plugin that registers tools', async () => {
      const pluginDir = path.join(tmpDir, '.mimo', 'plugins', 'tool-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });

      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        name: 'tool-plugin',
        version: '1.0.0',
        description: 'Registers a tool',
        main: 'index.js',
      }));

      fs.writeFileSync(path.join(pluginDir, 'index.js'), `
        module.exports = {
          manifest: { name: 'tool-plugin', version: '1.0.0', description: 'Registers a tool', main: 'index.js' },
          activate(ctx) {
            ctx.registerTool({
              name: 'custom_tool',
              description: 'A custom tool',
              parameters: { type: 'object', properties: {} },
              execute: async () => 'custom result',
            });
          },
        };
      `);

      const registry = new ToolRegistry();
      const manager = new PluginManager(registry);
      await manager.discoverAndActivate(tmpDir, {
        provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
        agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
        ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
        mcp: { servers: [] },
      });

      expect(registry.allToolNames).toContain('custom_tool');
    });
  });

  describe('deactivateAll', () => {
    it('deactivates all plugins and resets count', async () => {
      const pluginDir = path.join(tmpDir, '.mimo', 'plugins', 'deact-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });

      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        name: 'deact-plugin',
        version: '1.0.0',
        description: 'Test deactivation',
        main: 'index.js',
      }));

      fs.writeFileSync(path.join(pluginDir, 'index.js'), `
        let deactivated = false;
        module.exports = {
          manifest: { name: 'deact-plugin', version: '1.0.0', description: 'Test deactivation', main: 'index.js' },
          activate(ctx) {},
          deactivate() { deactivated = true; },
        };
      `);

      const manager = new PluginManager(toolRegistry);
      await manager.discoverAndActivate(tmpDir, {
        provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
        agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
        ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
        mcp: { servers: [] },
      });

      expect(manager.activeCount).toBe(1);
      await manager.deactivateAll();
      expect(manager.activeCount).toBe(0);
      expect(manager.activePluginNames).toEqual([]);
    });

    it('handles deactivation of plugins without deactivate method', async () => {
      const pluginDir = path.join(tmpDir, '.mimo', 'plugins', 'no-deact');
      fs.mkdirSync(pluginDir, { recursive: true });

      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        name: 'no-deact',
        version: '1.0.0',
        description: 'No deactivate',
        main: 'index.js',
      }));

      fs.writeFileSync(path.join(pluginDir, 'index.js'), `
        module.exports = {
          manifest: { name: 'no-deact', version: '1.0.0', description: 'No deactivate', main: 'index.js' },
          activate(ctx) {},
        };
      `);

      const manager = new PluginManager(toolRegistry);
      await manager.discoverAndActivate(tmpDir, {
        provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
        agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
        ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
        mcp: { servers: [] },
      });

      // Should not throw even without deactivate method
      await expect(manager.deactivateAll()).resolves.toBeUndefined();
      expect(manager.activeCount).toBe(0);
    });
  });

  describe('invalid plugin handling', () => {
    it('handles plugin with missing manifest gracefully', async () => {
      const pluginDir = path.join(tmpDir, '.mimo', 'plugins', 'bad-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });
      // No manifest.json

      const manager = new PluginManager(toolRegistry);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await manager.discoverAndActivate(tmpDir, {
        provider: { apiKey: '', baseUrl: '', model: '', providerType: 'auto' },
        agent: { mode: 'agent', maxIterations: 32, autoApproveReads: true, thinkingEnabled: true, reasoningEffort: 'medium' },
        ui: { theme: 'default', showThinking: true, showTokens: true, compactMode: false, locale: 'zh' },
        mcp: { servers: [] },
      });

      // Should not activate anything (no valid manifest)
      expect(manager.activeCount).toBe(0);
      stderrSpy.mockRestore();
    });
  });
});
