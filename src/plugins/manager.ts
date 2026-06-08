// src/plugins/manager.ts - Plugin lifecycle manager

import fs from 'fs';
import path from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import type { Config } from '../config.js';
import type { Plugin, PluginManifest } from './types.js';
import { PluginContextImpl } from './context.js';

interface LoadedPlugin {
  plugin: Plugin;
  context: PluginContextImpl;
}

export class PluginManager {
  private loadedPlugins: LoadedPlugin[] = [];
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Discover plugins from .mimo/plugins/ and node_modules/mimo-plugin-*,
   * then activate all of them.
   */
  async discoverAndActivate(cwd: string, config: Config): Promise<void> {
    // 1. Discover from local .mimo/plugins/ directory
    const localPlugins = this.discoverLocalPlugins(cwd);
    // 2. Discover from node_modules/mimo-plugin-* pattern
    const npmPlugins = this.discoverNpmPlugins(cwd);

    const allEntries = [...localPlugins, ...npmPlugins];

    for (const entry of allEntries) {
      try {
        // Create a separate context per plugin to avoid shared state
        const context = new PluginContextImpl(config, cwd);
        const plugin = await this.loadPlugin(entry.pluginDir, entry.manifest);
        await plugin.activate(context);

        // Register tools and commands from this plugin
        for (const tool of context.getRegisteredTools()) {
          this.toolRegistry.register(tool);
        }

        this.loadedPlugins.push({ plugin, context });
      } catch (err) {
        process.stderr.write(
          `Plugin "${entry.manifest.name}" failed to activate: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  /** Check if any plugin has registered a command with the given name */
  hasCommand(name: string): boolean {
    return this.loadedPlugins.some(({ context }) => context.hasCommand(name));
  }

  /** Execute a plugin command by name */
  async executeCommand(name: string, args: string[]): Promise<string> {
    for (const { context } of this.loadedPlugins) {
      const handler = context.getCommand(name);
      if (handler) {
        return await handler(args, context);
      }
    }
    return `Unknown plugin command: ${name}`;
  }

  /** Deactivate all plugins (cleanup) */
  async deactivateAll(): Promise<void> {
    for (const { plugin } of this.loadedPlugins) {
      try {
        if (plugin.deactivate) {
          await plugin.deactivate();
        }
      } catch (err) {
        process.stderr.write(
          `Plugin "${plugin.manifest.name}" failed to deactivate: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
    this.loadedPlugins = [];
  }

  /** Get the number of active plugins */
  get activeCount(): number {
    return this.loadedPlugins.length;
  }

  /** Get names of all active plugins */
  get activePluginNames(): string[] {
    return this.loadedPlugins.map(({ plugin }) => plugin.manifest.name);
  }

  // --- Private helpers ---

  private discoverLocalPlugins(cwd: string): Array<{ pluginDir: string; manifest: PluginManifest }> {
    const pluginsDir = path.join(cwd, '.mimo', 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const results: Array<{ pluginDir: string; manifest: PluginManifest }> = [];

    try {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(pluginsDir, entry.name);
        const manifest = this.readManifest(pluginDir);
        if (manifest) {
          results.push({ pluginDir, manifest });
        }
      }
    } catch {
      // Ignore read errors
    }

    return results;
  }

  private discoverNpmPlugins(cwd: string): Array<{ pluginDir: string; manifest: PluginManifest }> {
    const nodeModulesDir = path.join(cwd, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) return [];

    const results: Array<{ pluginDir: string; manifest: PluginManifest }> = [];

    try {
      const entries = fs.readdirSync(nodeModulesDir);
      for (const entry of entries) {
        if (!entry.startsWith('mimo-plugin-')) continue;

        // Handle scoped packages: @scope/mimo-plugin-*
        const fullPath = path.join(nodeModulesDir, entry);
        if (entry.startsWith('@')) {
          try {
            const scopedEntries = fs.readdirSync(fullPath);
            for (const scopedEntry of scopedEntries) {
              if (!scopedEntry.startsWith('mimo-plugin-')) continue;
              const scopedPath = path.join(fullPath, scopedEntry);
              const manifest = this.readManifest(scopedPath);
              if (manifest) {
                results.push({ pluginDir: scopedPath, manifest });
              }
            }
          } catch {
            // Ignore read errors for scoped dirs
          }
        } else {
          const manifest = this.readManifest(fullPath);
          if (manifest) {
            results.push({ pluginDir: fullPath, manifest });
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return results;
  }

  private readManifest(pluginDir: string): PluginManifest | null {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;
      // Validate required fields
      if (!manifest.name || !manifest.version || !manifest.main) return null;
      return manifest;
    } catch {
      return null;
    }
  }

  private async loadPlugin(pluginDir: string, manifest: PluginManifest): Promise<Plugin> {
    const entryPath = path.join(pluginDir, manifest.main);

    // Dynamic import the plugin entry file
    const mod = await import(entryPath);

    // Support both default export and named export
    const plugin: Plugin = mod.default ?? mod.plugin ?? mod;

    if (!plugin || typeof plugin.activate !== 'function') {
      throw new Error(`Invalid plugin "${manifest.name}": missing activate() function`);
    }

    // Attach manifest if not already present
    if (!plugin.manifest) {
      plugin.manifest = manifest;
    }

    return plugin;
  }
}
