// src/config.ts - Configuration system

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseToml } from 'smol-toml';
import type { AgentMode, MCPServerConfig } from './api/types.js';
import type { ProviderType } from './api/providers/index.js';
import type { Locale } from './utils/i18n.js';

const CONFIG_DIR = path.join(os.homedir(), '.mimo');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');

export interface Config {
  provider: {
    apiKey: string;
    baseUrl: string;
    model: string;
    providerType: ProviderType;
  };
  agent: {
    mode: AgentMode;
    maxIterations: number;
    autoApproveReads: boolean;
    thinkingEnabled: boolean;
    reasoningEffort: 'low' | 'medium' | 'high' | 'auto';
  };
  ui: {
    theme: string;
    showThinking: boolean;
    showTokens: boolean;
    compactMode: boolean;
    locale: Locale;
  };
  mcp: {
    servers: MCPServerConfig[];
  };
}

export const DEFAULT_CONFIG: Config = {
  provider: {
    apiKey: '',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5-pro',
    providerType: 'auto',
  },
  agent: {
    mode: 'agent',
    maxIterations: 32,
    autoApproveReads: true,
    thinkingEnabled: true,
    reasoningEffort: 'medium',
  },
  ui: {
    theme: 'default',
    showThinking: true,
    showTokens: true,
    compactMode: false,
    locale: 'zh' as Locale,
  },
  mcp: {
    servers: [],
  },
};

export function loadConfig(): Config {
  const config = { ...DEFAULT_CONFIG };

  // Load from config file
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const toml = parseToml(content);

      if (toml.provider) {
        const p = toml.provider as Record<string, unknown>;
        if (p.api_key) config.provider.apiKey = String(p.api_key);
        if (p.base_url) config.provider.baseUrl = String(p.base_url);
        if (p.model) config.provider.model = String(p.model);
        if (p.provider_type) config.provider.providerType = p.provider_type as ProviderType;
      }
      if (toml.agent) {
        const a = toml.agent as Record<string, unknown>;
        if (a.mode) config.agent.mode = a.mode as AgentMode;
        if (a.max_iterations) config.agent.maxIterations = Number(a.max_iterations);
        if (a.auto_approve_reads !== undefined) config.agent.autoApproveReads = Boolean(a.auto_approve_reads);
        if (a.thinking_enabled !== undefined) config.agent.thinkingEnabled = Boolean(a.thinking_enabled);
        if (a.reasoning_effort) config.agent.reasoningEffort = a.reasoning_effort as 'low' | 'medium' | 'high';
      }
      if (toml.ui) {
        const u = toml.ui as Record<string, unknown>;
        if (u.theme) config.ui.theme = String(u.theme);
        if (u.show_thinking !== undefined) config.ui.showThinking = Boolean(u.show_thinking);
        if (u.show_tokens !== undefined) config.ui.showTokens = Boolean(u.show_tokens);
        if (u.compact_mode !== undefined) config.ui.compactMode = Boolean(u.compact_mode);
        if (u.locale && (u.locale === 'zh' || u.locale === 'en')) config.ui.locale = u.locale as Locale;
      }
      if (toml.mcp && (toml.mcp as Record<string, unknown>).servers) {
        config.mcp.servers = ((toml.mcp as Record<string, unknown>).servers as Record<string, unknown>[]).map(s => ({
          name: String(s.name || ''),
          transport: (s.transport as 'stdio' | 'http') || 'stdio',
          command: s.command ? String(s.command) : undefined,
          args: s.args ? (s.args as string[]) : undefined,
          url: s.url ? String(s.url) : undefined,
          env: s.env ? (s.env as Record<string, string>) : undefined,
        }));
      }
    } catch (e) {
      process.stderr.write(`Warning: Failed to parse config file: ${e}\n`);
    }
  }

  // Environment variable overrides
  if (process.env.MIMO_API_KEY) config.provider.apiKey = process.env.MIMO_API_KEY;
  if (process.env.MIMO_BASE_URL) config.provider.baseUrl = process.env.MIMO_BASE_URL;
  if (process.env.MIMO_MODEL) config.provider.model = process.env.MIMO_MODEL;
  if (process.env.MIMO_PROVIDER_TYPE) config.provider.providerType = process.env.MIMO_PROVIDER_TYPE as ProviderType;

  return config;
}

function escapeTomlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const toml = `[provider]
api_key = "${escapeTomlString(config.provider.apiKey)}"
base_url = "${escapeTomlString(config.provider.baseUrl)}"
model = "${escapeTomlString(config.provider.model)}"
provider_type = "${config.provider.providerType}"

[agent]
mode = "${config.agent.mode}"
max_iterations = ${config.agent.maxIterations}
auto_approve_reads = ${config.agent.autoApproveReads}
thinking_enabled = ${config.agent.thinkingEnabled}
reasoning_effort = "${config.agent.reasoningEffort}"

[ui]
theme = "${escapeTomlString(config.ui.theme)}"
show_thinking = ${config.ui.showThinking}
show_tokens = ${config.ui.showTokens}
compact_mode = ${config.ui.compactMode}
locale = "${config.ui.locale}"
`;

  fs.writeFileSync(CONFIG_FILE, toml, 'utf-8');
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
