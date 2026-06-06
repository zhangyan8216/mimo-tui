// src/utils/memory.ts - AI 记忆系统（跨会话记忆用户偏好）

import fs from 'fs';
import path from 'path';
import os from 'os';

const MEMORY_FILE = path.join(os.homedir(), '.mimo', 'memory.json');

export interface Memory {
  key: string;
  value: string;
  category: 'preference' | 'fact' | 'instruction' | 'context';
  created: string;
  updated: string;
  accessCount: number;
}

export class MemoryStore {
  private memories: Memory[] = [];

  constructor() {
    this.load();
  }

  /** 记住一条信息 */
  remember(key: string, value: string, category: Memory['category'] = 'fact'): void {
    const existing = this.memories.find(m => m.key === key);
    if (existing) {
      existing.value = value;
      existing.category = category;
      existing.updated = new Date().toISOString();
      existing.accessCount++;
    } else {
      this.memories.push({
        key, value, category,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        accessCount: 0,
      });
    }
    this.save();
  }

  /** 回忆一条信息 */
  recall(key: string): string | null {
    const mem = this.memories.find(m => m.key === key);
    if (mem) {
      mem.accessCount++;
      this.save();
      return mem.value;
    }
    return null;
  }

  /** 搜索记忆 */
  search(query: string): Memory[] {
    const lower = query.toLowerCase();
    return this.memories.filter(m =>
      m.key.toLowerCase().includes(lower) ||
      m.value.toLowerCase().includes(lower)
    );
  }

  /** 获取所有记忆，按类别分组 */
  getByCategory(): Map<string, Memory[]> {
    const map = new Map<string, Memory[]>();
    for (const m of this.memories) {
      const existing = map.get(m.category) || [];
      existing.push(m);
      map.set(m.category, existing);
    }
    return map;
  }

  /** 删除记忆 */
  forget(key: string): boolean {
    const idx = this.memories.findIndex(m => m.key === key);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    this.save();
    return true;
  }

  /** 获取所有记忆摘要（注入到系统提示词） */
  getContextSummary(): string {
    if (this.memories.length === 0) return '';
    const lines = ['## 用户记忆\n'];
    for (const m of this.memories) {
      lines.push(`- [${m.category}] ${m.key}: ${m.value}`);
    }
    return lines.join('\n');
  }

  list(): Memory[] {
    return [...this.memories];
  }

  private load(): void {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        this.memories = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memories, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
