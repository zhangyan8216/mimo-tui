// src/mcp/client.ts - MCP client (stdio + HTTP)

import { spawn, type ChildProcess } from 'child_process';
import type { MCPServerConfig, ToolDefinition } from '../api/types.js';
import { log } from '../utils/logger.js';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPClient {
  private servers: Map<string, {
    config: MCPServerConfig;
    process?: ChildProcess;
    tools: MCPTool[];
    requestId: number;
    pending: Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>;
  }> = new Map();

  async connectServer(config: MCPServerConfig): Promise<void> {
    const server = {
      config,
      tools: [] as MCPTool[],
      requestId: 0,
      pending: new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>(),
    };

    if (config.transport === 'stdio' && config.command) {
      await this.connectStdio(server, config);
    } else if (config.transport === 'http' && config.url) {
      // HTTP transport - just discover tools
      log('info', `MCP HTTP server: ${config.name} at ${config.url}`);
    }

    this.servers.set(config.name, server);
  }

  private async connectStdio(
    server: { config: MCPServerConfig; process?: ChildProcess; tools: MCPTool[]; requestId: number; pending: Map<number, { resolve: (v: unknown) => void; reject: (r: unknown) => void }> },
    config: MCPServerConfig,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(config.command!, config.args || [], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      server.process = proc;

      let buffer = '';

      proc.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const response = JSON.parse(trimmed) as MCPResponse;
            const pending = server.pending.get(response.id);
            if (pending) {
              server.pending.delete(response.id);
              if (response.error) {
                pending.reject(new Error(response.error.message));
              } else {
                pending.resolve(response.result);
              }
            }
          } catch {
            // Skip malformed messages
          }
        }
      });

      proc.on('error', reject);

      // Initialize
      setTimeout(async () => {
        try {
          await this.sendRequest(server, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mimo-tui', version: '1.0.0' },
          });

          // Discover tools
          const result = await this.sendRequest(server, 'tools/list', {}) as { tools: MCPTool[] };
          server.tools = result.tools || [];

          log('info', `MCP server ${config.name}: discovered ${server.tools.length} tools`);
          resolve();
        } catch (e) {
          log('warn', `MCP server ${config.name} init failed`, e);
          resolve(); // Don't fail - server just won't have tools
        }
      }, 500);
    });
  }

  private sendRequest(server: { requestId: number; pending: Map<number, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>; process?: ChildProcess }, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++server.requestId;
      const request: MCPRequest = { jsonrpc: '2.0', id, method, params };

      server.pending.set(id, { resolve, reject });

      const data = JSON.stringify(request) + '\n';
      server.process?.stdin?.write(data);

      // Timeout
      setTimeout(() => {
        if (server.pending.has(id)) {
          server.pending.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`MCP server not found: ${serverName}`);

    if (server.config.transport === 'stdio') {
      const result = await this.sendRequest(server, 'tools/call', {
        name: toolName,
        arguments: args,
      }) as { content?: { type: string; text: string }[] };

      if (result?.content) {
        return result.content.map(c => c.text).join('\n');
      }
      return JSON.stringify(result);
    }

    // HTTP transport
    if (server.config.url) {
      const response = await fetch(`${server.config.url}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: toolName, arguments: args }),
      });
      const result = await response.json() as { content?: { type: string; text: string }[] };
      if (result?.content) {
        return result.content.map(c => c.text).join('\n');
      }
      return JSON.stringify(result);
    }

    throw new Error('No transport configured');
  }

  getAllToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const [serverName, server] of this.servers) {
      for (const tool of server.tools) {
        defs.push({
          type: 'function',
          function: {
            name: `mcp_${serverName}_${tool.name}`,
            description: `[MCP: ${serverName}] ${tool.description}`,
            parameters: tool.inputSchema,
          },
        });
      }
    }
    return defs;
  }

  findServerForTool(toolName: string): { serverName: string; toolName: string } | null {
    const prefix = 'mcp_';
    if (!toolName.startsWith(prefix)) return null;

    for (const [serverName, server] of this.servers) {
      const serverPrefix = `${prefix}${serverName}_`;
      if (toolName.startsWith(serverPrefix)) {
        const realToolName = toolName.slice(serverPrefix.length);
        if (server.tools.some(t => t.name === realToolName)) {
          return { serverName, toolName: realToolName };
        }
      }
    }
    return null;
  }

  async disconnectAll(): Promise<void> {
    for (const [, server] of this.servers) {
      server.process?.kill();
    }
    this.servers.clear();
  }
}
