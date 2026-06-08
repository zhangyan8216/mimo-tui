// src/utils/history.ts - 持久化命令历史

import fs from 'fs';
import path from 'path';
import { getMimoPath } from './paths.js';

const MAX_HISTORY = 200;

function getHistoryFile(): string {
  return getMimoPath('history.json');
}

export class CommandHistory {
  private history: string[] = [];
  private index = -1;

  constructor() {
    this.load();
  }

  add(entry: string): void {
    // 去重：如果和最后一条相同就不加
    if (this.history.length > 0 && this.history[this.history.length - 1] === entry) return;
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
    this.save();
    this.index = this.history.length;
  }

  up(): string | null {
    if (this.history.length === 0) return null;
    this.index = Math.max(0, this.index - 1);
    return this.history[this.index] || null;
  }

  down(): string | null {
    if (this.history.length === 0) return null;
    this.index = Math.min(this.history.length, this.index + 1);
    return this.history[this.index] || null;
  }

  reset(): void {
    this.index = this.history.length;
  }

  getAll(): string[] {
    return [...this.history];
  }

  search(query: string): string[] {
    const lower = query.toLowerCase();
    return this.history.filter(h => h.toLowerCase().includes(lower)).reverse();
  }

  private load(): void {
    const historyFile = getHistoryFile();
    try {
      if (fs.existsSync(historyFile)) {
        const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
        this.history = Array.isArray(parsed) ? parsed : [];
        this.index = this.history.length;
      }
    } catch { /* corrupted file — keep empty */ }
  }

  private save(): void {
    const historyFile = getHistoryFile();
    try {
      fs.mkdirSync(path.dirname(historyFile), { recursive: true });
      fs.writeFileSync(historyFile, JSON.stringify(this.history), 'utf-8');
    } catch { /* ignore */ }
  }
}
