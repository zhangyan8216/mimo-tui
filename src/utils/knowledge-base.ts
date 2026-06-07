import fs from 'fs';
import path from 'path';
import os from 'os';

const KB_DIR = path.join(os.homedir(), '.mimo', 'knowledge');

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

  /** Add a knowledge entry */
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

  /** Search knowledge base */
  search(query: string): KnowledgeEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter(e =>
      e.title.toLowerCase().includes(lower) ||
      e.content.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower))
    ).sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  /** Get all entries */
  list(): KnowledgeEntry[] {
    return [...this.entries].sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  /** Get entry by ID */
  get(id: string): KnowledgeEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  /** Delete entry */
  delete(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    this.save();
    return true;
  }

  /** Get context summary for system prompt */
  getContextSummary(): string {
    if (this.entries.length === 0) return '';
    const lines = ['## 知识库\n'];
    for (const e of this.entries.slice(-20)) {
      lines.push(`- [${e.tags.join(',')}] ${e.title}: ${e.content.slice(0, 100)}`);
    }
    return lines.join('\n');
  }

  private load(): void {
    try {
      const kbFile = path.join(KB_DIR, 'entries.json');
      if (fs.existsSync(kbFile)) {
        this.entries = JSON.parse(fs.readFileSync(kbFile, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(KB_DIR, { recursive: true });
      fs.writeFileSync(path.join(KB_DIR, 'entries.json'), JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
