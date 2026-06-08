// src/tools/install.ts - Install skills and MCP servers

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Skill, MCPServerConfig } from '../api/types.js';
import { getMimoPath } from '../utils/paths.js';

const SKILLS_DIR = path.join(process.cwd(), '.mimo', 'skills');
function getGlobalSkillsDir(): string {
  return getMimoPath('skills');
}

// ─── Skill Installation ─────────────────────────────────────────────

export interface SkillInstallResult {
  name: string;
  description: string;
  triggers: string[];
  path: string;
  source: string;
}

/**
 * Install a skill from URL, npm package, or local path.
 */
export async function installSkill(source: string): Promise<SkillInstallResult> {
  let content: string;
  let sourceLabel: string;

  if (source.startsWith('http://') || source.startsWith('https://')) {
    // URL source
    content = await fetchSkillFromUrl(source);
    sourceLabel = source;
  } else if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || fs.existsSync(source)) {
    // Local file
    const resolved = path.resolve(source);
    if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
    content = fs.readFileSync(resolved, 'utf-8');
    sourceLabel = resolved;
  } else {
    // npm package name
    content = await fetchSkillFromNpm(source);
    sourceLabel = `npm:${source}`;
  }

  // Parse and validate
  const parsed = parseSkillContent(content);

  // Write to project skills directory
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const filename = `${parsed.name}.md`;
  const targetPath = path.join(SKILLS_DIR, filename);
  fs.writeFileSync(targetPath, content, 'utf-8');

  return {
    name: parsed.name,
    description: parsed.description,
    triggers: parsed.triggers,
    path: targetPath,
    source: sourceLabel,
  };
}

/**
 * Uninstall a skill by name.
 */
export function uninstallSkill(name: string): { removed: boolean; path?: string } {
  const candidates = [
    path.join(SKILLS_DIR, `${name}.md`),
    path.join(getGlobalSkillsDir(), `${name}.md`),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return { removed: true, path: p };
    }
  }
  return { removed: false };
}

/**
 * List all installed skills.
 */
export function listInstalledSkills(): Skill[] {
  const skills: Skill[] = [];
  for (const dir of [SKILLS_DIR, getGlobalSkillsDir()]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      try {
        const parsed = parseSkillContent(content);
        skills.push({
          name: parsed.name,
          description: parsed.description,
          path: path.join(dir, file),
          content: parsed.body,
          triggers: parsed.triggers,
        });
      } catch { /* skip invalid */ }
    }
  }
  return skills;
}

// ─── MCP Server Installation ─────────────────────────────────────────

export interface McpInstallResult {
  name: string;
  config: MCPServerConfig;
}

/**
 * Parse an MCP install command string.
 * Format: <name> <command> [args...]
 * Example: "filesystem npx -y @modelcontextprotocol/server-filesystem /tmp"
 */
export function parseMcpInstallArgs(input: string): MCPServerConfig {
  const parts = input.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error('用法: /install mcp <name> <command> [args...]\n示例: /install mcp filesystem npx -y @modelcontextprotocol/server-filesystem');
  }

  const name = parts[0];
  const command = parts[1];
  const args = parts.slice(2);

  // Validate name (alphanumeric, dash, underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`无效的服务器名称: ${name}。只允许字母、数字、连字符和下划线。`);
  }

  return {
    name,
    transport: 'stdio',
    command,
    args: args.length > 0 ? args : undefined,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────

interface ParsedSkill {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}

function parseSkillContent(content: string): ParsedSkill {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error('无效的 skill 格式: 缺少 frontmatter (--- 块)');
  }

  const meta = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  const name = extractField(meta, 'name') || 'unnamed-skill';
  const description = extractField(meta, 'description') || '';
  const triggersStr = extractField(meta, 'triggers') || '';
  const triggers = triggersStr.split(',').map(t => t.trim()).filter(Boolean);

  if (!body && triggers.length === 0) {
    throw new Error('无效的 skill: 缺少 content 和 triggers');
  }

  return { name, description, triggers, body };
}

function extractField(meta: string, field: string): string | null {
  const match = meta.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

async function fetchSkillFromUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'mimo-ai-cli/1.3.1' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchSkillFromNpm(packageName: string): Promise<string> {
  // Use npm view to get the package tarball URL, then fetch and extract
  const { execSync } = await import('child_process');

  try {
    // Get package info
    const info = execSync(`npm view ${packageName} --json`, {
      encoding: 'utf-8',
      timeout: 15000,
    });
    const pkg = JSON.parse(info);

    // Look for .md files in the package
    const readme = pkg.readme;
    if (readme && readme.includes('---')) {
      return readme;
    }

    // Try to download and extract
    const tmpDir = path.join(os.tmpdir(), `mimo-skill-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      execSync(`npm pack ${packageName} --pack-destination ${tmpDir}`, {
        encoding: 'utf-8',
        timeout: 30000,
      });
      const tgz = fs.readdirSync(tmpDir).find(f => f.endsWith('.tgz'));
      if (tgz) {
        execSync(`tar -xzf ${path.join(tmpDir, tgz)} -C ${tmpDir}`, {
          encoding: 'utf-8',
          timeout: 10000,
        });
        // Find .md files
        const mdFiles = findMdFiles(tmpDir);
        if (mdFiles.length > 0) {
          return fs.readFileSync(mdFiles[0], 'utf-8');
        }
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }

    throw new Error(`包 ${packageName} 中未找到 .md skill 文件`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('未找到')) throw err;
    throw new Error(`npm 包 ${packageName} 安装失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        results.push(...findMdFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  } catch { /* ignore */ }
  return results;
}
