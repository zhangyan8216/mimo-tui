// src/utils/knowledge-base.ts - Persistent user knowledge entries.

import fs from 'fs';
import path from 'path';
import { getMimoPath } from './paths.js';

function getKnowledgeDir(): string {
  return getMimoPath('knowledge');
}

function getKnowledgeFile(): string {
  return path.join(getKnowledgeDir(), 'entries.json');
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created: string;
  updated: string;
  source: 'user' | 'auto' | 'session';
}

export class KnowledgeBase {
  private entries: KnowledgeEntry[] = [];

  constructor() {
    this.load();
  }

  add(title: string, content: string, tags: string[] = [], source: KnowledgeEntry['source'] = 'user'): KnowledgeEntry {
    const entry: KnowledgeEntry = {
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      content,
      tags,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      source,
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  search(query: string): KnowledgeEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter(e =>
      e.title.toLowerCase().includes(lower) ||
      e.content.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower))
    ).sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  list(): KnowledgeEntry[] {
    return [...this.entries].sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  get(id: string): KnowledgeEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  delete(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    this.save();
    return true;
  }

  getContextSummary(): string {
    if (this.entries.length === 0) return '';
    const lines = ['## Knowledge Base\n'];
    for (const e of this.entries.slice(-20)) {
      lines.push(`- [${e.tags.join(',')}] ${e.title}: ${e.content.slice(0, 100)}`);
    }
    return lines.join('\n');
  }

  private load(): void {
    const knowledgeFile = getKnowledgeFile();
    try {
      if (fs.existsSync(knowledgeFile)) {
        const parsed = JSON.parse(fs.readFileSync(knowledgeFile, 'utf-8'));
        this.entries = Array.isArray(parsed) ? parsed : [];
      }
    } catch { /* corrupted file: keep empty */ }
  }

  private save(): void {
    const knowledgeDir = getKnowledgeDir();
    try {
      fs.mkdirSync(knowledgeDir, { recursive: true });
      fs.writeFileSync(getKnowledgeFile(), JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
