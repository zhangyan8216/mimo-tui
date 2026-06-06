// src/utils/watcher.ts - 文件监控（实时检测项目变化）

import fs from 'fs';
import path from 'path';

export interface FileChange {
  type: 'created' | 'modified' | 'deleted';
  path: string;
  timestamp: number;
}

export class FileWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private changes: FileChange[] = [];
  private onChange: ((change: FileChange) => void) | null = null;
  private ignorePatterns: RegExp[];

  constructor() {
    this.ignorePatterns = [
      /node_modules/,
      /\.git[\\/]/,
      /dist[\\/]/,
      /build[\\/]/,
      /\.next[\\/]/,
      /__pycache__/,
      /\.pyc$/,
      /\.o$/,
    ];
  }

  /** 监控目录 */
  watch(dir: string, callback: (change: FileChange) => void): void {
    this.onChange = callback;

    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, filename);

        // 忽略特定文件
        if (this.ignorePatterns.some(p => p.test(fullPath))) return;

        const change: FileChange = {
          type: eventType === 'rename' ? (fs.existsSync(fullPath) ? 'created' : 'deleted') : 'modified',
          path: fullPath,
          timestamp: Date.now(),
        };

        this.changes.push(change);
        if (this.changes.length > 100) this.changes.shift();
        this.onChange?.(change);
      });

      this.watchers.set(dir, watcher);
    } catch { /* ignore */ }
  }

  /** 获取最近的变更 */
  getRecentChanges(n = 10): FileChange[] {
    return this.changes.slice(-n);
  }

  /** 获取变更摘要 */
  getSummary(): string {
    if (this.changes.length === 0) return '无文件变更';
    const recent = this.changes.slice(-5);
    return recent.map(c => {
      const icon = c.type === 'created' ? '✨' : c.type === 'modified' ? '📝' : '🗑️';
      const relPath = path.relative(process.cwd(), c.path);
      return `${icon} ${relPath}`;
    }).join('\n');
  }

  /** 停止监控 */
  stop(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
