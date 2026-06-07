// src/plugins/context.ts - PluginContext implementation

import type { Tool } from '../tools/registry.js';
import type { Config } from '../config.js';
import type { PluginContext, PluginCommandHandler } from './types.js';

export class PluginContextImpl implements PluginContext {
  private tools: Tool[] = [];
  private commands: Map<string, PluginCommandHandler> = new Map();
  private config: Config;
  private cwd: string;

  constructor(config: Config, cwd: string) {
    this.config = config;
    this.cwd = cwd;
  }

  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  registerCommand(name: string, handler: PluginCommandHandler): void {
    this.commands.set(name, handler);
  }

  getConfig(): Config {
    return this.config;
  }

  getCwd(): string {
    return this.cwd;
  }

  /** Get all tools registered through this context */
  getRegisteredTools(): Tool[] {
    return [...this.tools];
  }

  /** Get all commands registered through this context */
  getRegisteredCommands(): Map<string, PluginCommandHandler> {
    return new Map(this.commands);
  }

  /** Check if a command is registered */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /** Get a command handler by name */
  getCommand(name: string): PluginCommandHandler | undefined {
    return this.commands.get(name);
  }
}
