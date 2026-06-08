// src/utils/memory.ts - Persistent AI memory across sessions.

import fs from 'fs';
import path from 'path';
import { getMimoPath } from './paths.js';

function getMemoryFile(): string {
  return getMimoPath('memory.json');
}

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
  private saveQueued = false;

  constructor() {
    this.load();
  }

  private scheduleSave(): void {
    if (!this.saveQueued) {
      this.saveQueued = true;
      setTimeout(() => { this.saveQueued = false; this.save(); }, 1000);
    }
  }

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

  recall(key: string): string | null {
    const mem = this.memories.find(m => m.key === key);
    if (!mem) return null;
    mem.accessCount++;
    this.scheduleSave();
    return mem.value;
  }

  search(query: string): Memory[] {
    const lower = query.toLowerCase();
    return this.memories.filter(m =>
      m.key.toLowerCase().includes(lower) ||
      m.value.toLowerCase().includes(lower)
    );
  }

  getByCategory(): Map<string, Memory[]> {
    const map = new Map<string, Memory[]>();
    for (const m of this.memories) {
      const existing = map.get(m.category) || [];
      existing.push(m);
      map.set(m.category, existing);
    }
    return map;
  }

  forget(key: string): boolean {
    const idx = this.memories.findIndex(m => m.key === key);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    this.save();
    return true;
  }

  getContextSummary(): string {
    if (this.memories.length === 0) return '';
    const lines = ['## User Memory\n'];
    for (const m of this.memories) {
      lines.push(`- [${m.category}] ${m.key}: ${m.value}`);
    }
    return lines.join('\n');
  }

  list(): Memory[] {
    return [...this.memories];
  }

  clear(): void {
    this.memories = [];
    this.save();
  }

  private load(): void {
    const memoryFile = getMemoryFile();
    try {
      if (fs.existsSync(memoryFile)) {
        const parsed = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
        this.memories = Array.isArray(parsed) ? parsed : [];
      }
    } catch { /* corrupted file: keep empty */ }
  }

  private save(): void {
    const memoryFile = getMemoryFile();
    try {
      fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
      fs.writeFileSync(memoryFile, JSON.stringify(this.memories, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
