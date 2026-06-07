// src/plugins/types.ts - Plugin system type definitions

import type { Tool } from '../tools/registry.js';
import type { Config } from '../config.js';

export interface PluginContext {
  registerTool(tool: Tool): void;
  registerCommand(name: string, handler: PluginCommandHandler): void;
  getConfig(): Config;
  getCwd(): string;
}

export type PluginCommandHandler = (args: string[], ctx: PluginContext) => Promise<string>;

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  main: string;  // entry point file
}

export interface Plugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
