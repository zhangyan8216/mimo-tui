// src/utils/snippets.ts - Persistent code snippet library.

import fs from 'fs';
import path from 'path';
import { getMimoPath } from './paths.js';

function getSnippetsFile(): string {
  return getMimoPath('snippets.json');
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  language: string;
  tags: string[];
  created: string;
}

export class SnippetLibrary {
  private snippets: Snippet[] = [];

  constructor() {
    this.load();
  }

  add(name: string, content: string, language = '', tags: string[] = []): Snippet {
    const snippet: Snippet = {
      id: Date.now().toString(36),
      name,
      content,
      language,
      tags,
      created: new Date().toISOString(),
    };
    this.snippets.push(snippet);
    this.save();
    return snippet;
  }

  remove(id: string): boolean {
    const idx = this.snippets.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.snippets.splice(idx, 1);
    this.save();
    return true;
  }

  search(query: string): Snippet[] {
    const lower = query.toLowerCase();
    return this.snippets.filter(s =>
      s.name.toLowerCase().includes(lower) ||
      s.content.toLowerCase().includes(lower) ||
      s.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  list(): Snippet[] {
    return [...this.snippets];
  }

  get(id: string): Snippet | undefined {
    return this.snippets.find(s => s.id === id);
  }

  private load(): void {
    const snippetsFile = getSnippetsFile();
    try {
      if (fs.existsSync(snippetsFile)) {
        const parsed = JSON.parse(fs.readFileSync(snippetsFile, 'utf-8'));
        this.snippets = Array.isArray(parsed) ? parsed : [];
      }
    } catch { /* corrupted file: keep empty */ }
  }

  private save(): void {
    const snippetsFile = getSnippetsFile();
    try {
      fs.mkdirSync(path.dirname(snippetsFile), { recursive: true });
      fs.writeFileSync(snippetsFile, JSON.stringify(this.snippets, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
