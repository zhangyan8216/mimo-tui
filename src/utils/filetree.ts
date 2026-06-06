// src/utils/filetree.ts - 文件树生成器

import fs from 'fs';
import path from 'path';

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.tox', 'coverage',
  '.idea', '.vscode', '.DS_Store', 'Thumbs.db',
]);

const MAX_DEPTH = 3;
const MAX_ENTRIES = 50;

/** 生成文件树 */
export function generateFileTree(dir: string, depth = 0, count = { n: 0 }): TreeNode[] {
  if (depth > MAX_DEPTH || count.n > MAX_ENTRIES) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  // 排序：目录在前，文件在后
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (count.n > MAX_ENTRIES) break;
    if (IGNORE.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;

    count.n++;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDir: true,
        children: generateFileTree(fullPath, depth + 1, count),
      });
    } else {
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDir: false,
      });
    }
  }

  return nodes;
}

/** 格式化文件树为文本 */
export function formatFileTree(nodes: TreeNode[], prefix = '', isLast = true): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLastNode = i === nodes.length - 1;
    const connector = isLastNode ? '└── ' : '├── ';
    const icon = node.isDir ? '📁 ' : '📄 ';
    const line = `${prefix}${connector}${icon}${node.name}`;
    lines.push(line);

    if (node.children && node.children.length > 0) {
      const childPrefix = prefix + (isLastNode ? '    ' : '│   ');
      lines.push(formatFileTree(node.children, childPrefix, isLastNode));
    }
  }

  return lines.join('\n');
}
