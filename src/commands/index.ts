// src/commands/index.ts - Command router

import { handleGitCommand } from './git.js';
import { handleSessionCommand } from './session.js';
import { handleCostCommand } from './cost.js';
import { handleAICommand } from './ai.js';
import { handleToolsCommand } from './tools.js';
import type { CommandContext } from './types.js';

export function handleSlashCommand(cmd: string, cmdArgs: string[], ctx: CommandContext): boolean {
  switch (cmd) {
    // Git commands
    case 'git':
      handleGitCommand(cmdArgs[0] || 'status', cmdArgs.slice(1), ctx);
      return true;

    // Session commands
    case 'new':
    case 'fork':
    case 'save':
    case 'list':
    case 'clear':
    case 'retry':
    case 'undo':
    case 'export':
    case 'rename':
    case 'search':
    case 'history':
    case 'mode':
      handleSessionCommand(cmd, cmdArgs, ctx);
      return true;

    // Cost / model / metrics commands
    case 'cost':
    case 'usage':
    case 'model':
    case 'theme':
    case 'tokens':
    case 'stats':
    case 'metrics':
    case 'tips':
    case 'context':
      handleCostCommand(cmd, cmdArgs, ctx);
      return true;

    // AI capability commands
    case 'workflow':
    case 'wf':
    case 'parallel':
    case 'pipeline':
    case 'explore':
    case 'review':
    case 'sub':
    case 'status':
    case 'kill':
    case 'improve':
    case 'batch':
      handleAICommand(cmd, cmdArgs, ctx);
      return true;

    // Tool / utility commands
    case 'compact':
    case 'help':
    case 'tree':
    case 'project':
    case 'debug':
    case 'cd':
    case 'think':
    case 'health':
    case 'doctor':
    case 'fix':
    case 'template':
    case 'tpl':
    case 'snippet':
    case 'snip':
    case 'config':
    case 'cfg':
    case 'bookmark':
    case 'bm':
    case 'shortcuts':
    case 'keys':
    case 'remember':
    case 'mem':
    case 'forget':
    case 'clean':
    case 'suggest':
    case 'changes':
    case 'watch':
    case 'chain':
    case 'auto':
    case 'kb':
    case 'monitor':
    case 'install':
    case 'uninstall':
    case 'skills':
    case 'mcp':
      handleToolsCommand(cmd, cmdArgs, ctx);
      return true;

    default:
      return false; // Not handled by built-in commands
  }
}
