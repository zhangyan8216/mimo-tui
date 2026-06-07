// src/commands/types.ts - Command context interface

import type { Config } from '../config.js';
import type { Message, TokenUsage, AgentMode } from '../api/types.js';
import type { SessionManager } from '../session/manager.js';
import type { AgentLoop } from '../agent/loop.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Sandbox } from '../utils/sandbox.js';
import type { SubAgentManager } from '../agent/sub-agent.js';
import type { FileWatcher } from '../utils/watcher.js';
import type { SnippetLibrary } from '../utils/snippets.js';
import type { MemoryStore } from '../utils/memory.js';
import type { KnowledgeBase } from '../utils/knowledge-base.js';
import type { CommandHistory } from '../utils/history.js';
import type { Workflow } from '../utils/workflow.js';
import type { PluginManager } from '../plugins/manager.js';
import type { MCPClient } from '../mcp/client.js';
import type { monitor } from '../utils/monitor.js';

export interface CommandContext {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  config: Config;
  configRef: React.MutableRefObject<Config>;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  mode: AgentMode;
  modeRef: React.MutableRefObject<AgentMode>;
  setMode: React.Dispatch<React.SetStateAction<AgentMode>>;
  usage: TokenUsage;
  setUsage: React.Dispatch<React.SetStateAction<TokenUsage>>;
  sessionManager: React.MutableRefObject<SessionManager>;
  agentLoop: React.MutableRefObject<AgentLoop | null>;
  toolRegistry: React.MutableRefObject<ToolRegistry>;
  sandbox: React.MutableRefObject<Sandbox>;
  handleSubmit: (text: string) => void;
  setOverlay: React.Dispatch<React.SetStateAction<string>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
  cwd: string;

  // Additional refs used by commands
  subAgentManager: React.MutableRefObject<SubAgentManager | null>;
  fileWatcher: React.MutableRefObject<FileWatcher | null>;
  snippetLibrary: React.MutableRefObject<SnippetLibrary | null>;
  memoryStore: React.MutableRefObject<MemoryStore>;
  knowledgeBase: React.MutableRefObject<KnowledgeBase | null>;
  commandHistory: React.MutableRefObject<CommandHistory>;
  pluginManager: React.MutableRefObject<PluginManager | null>;
  mcpClient: React.MutableRefObject<MCPClient | null>;
  activeWorkflow: React.MutableRefObject<{ workflow: Workflow; stepIndex: number } | null>;
  autoCommit: React.MutableRefObject<boolean>;
  autoTest: React.MutableRefObject<boolean>;
  systemPrompt: React.MutableRefObject<string>;
  streamTimerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  setFileChanges: React.Dispatch<React.SetStateAction<string>>;
  handleSlashCommand: (text: string) => void;
}
