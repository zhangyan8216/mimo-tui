// src/session/store.ts - SQLite-based session persistence

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { Session, Message, TokenUsage, AgentMode } from '../api/types.js';

const DB_DIR = path.join(os.homedir(), '.mimo');
const DB_PATH = path.join(DB_DIR, 'sessions.db');

export class SessionStore {
  private db: Database.Database;

  constructor() {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT 'main',
        parent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        model TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'agent'
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS usage (
        session_id TEXT PRIMARY KEY,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cache_hit_tokens INTEGER DEFAULT 0,
        cache_miss_tokens INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
  }

  createSession(name: string, model: string, mode: AgentMode, parentId?: string): Session {
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const branch = parentId ? `branch_${Date.now()}` : 'main';

    this.db.prepare(
      'INSERT INTO sessions (id, name, branch, parent_id, created_at, updated_at, model, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, branch, parentId || null, now, now, model, mode);

    this.db.prepare(
      'INSERT INTO usage (session_id) VALUES (?)'
    ).run(id);

    return {
      id, name, branch, parent_id: parentId,
      created_at: now, updated_at: now,
      model, mode, messages: [],
      token_usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 },
    };
  }

  addMessage(sessionId: string, message: Message): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      sessionId,
      message.role,
      message.content,
      message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      message.tool_call_id || null,
      message.name || null,
      now,
    );

    this.db.prepare(
      'UPDATE sessions SET updated_at = ? WHERE id = ?'
    ).run(now, sessionId);
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(
      'SELECT role, content, tool_calls, tool_call_id, name FROM messages WHERE session_id = ? ORDER BY id'
    ).all(sessionId) as { role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null; name: string | null }[];

    return rows.map(row => {
      const msg: Message = {
        role: row.role as Message['role'],
        content: row.content,
      };
      if (row.tool_calls) msg.tool_calls = JSON.parse(row.tool_calls);
      if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
      if (row.name) msg.name = row.name;
      return msg;
    });
  }

  getSession(sessionId: string): Session | null {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).get(sessionId) as { id: string; name: string; branch: string; parent_id: string | null; created_at: string; updated_at: string; model: string; mode: string } | undefined;

    if (!row) return null;

    const usageRow = this.db.prepare(
      'SELECT * FROM usage WHERE session_id = ?'
    ).get(sessionId) as { prompt_tokens: number; completion_tokens: number; total_tokens: number; cache_hit_tokens: number; cache_miss_tokens: number } | undefined;

    return {
      id: row.id,
      name: row.name,
      branch: row.branch,
      parent_id: row.parent_id || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      model: row.model,
      mode: row.mode as AgentMode,
      messages: this.getMessages(sessionId),
      token_usage: {
        promptTokens: usageRow?.prompt_tokens || 0,
        completionTokens: usageRow?.completion_tokens || 0,
        totalTokens: usageRow?.total_tokens || 0,
        cacheHitTokens: usageRow?.cache_hit_tokens || 0,
        cacheMissTokens: usageRow?.cache_miss_tokens || 0,
      },
    };
  }

  listSessions(limit = 20): Session[] {
    const rows = this.db.prepare(
      'SELECT id FROM sessions ORDER BY updated_at DESC LIMIT ?'
    ).all(limit) as { id: string }[];

    return rows.map(r => this.getSession(r.id)!).filter(Boolean);
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM usage WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  updateUsage(sessionId: string, usage: TokenUsage): void {
    this.db.prepare(`
      UPDATE usage SET
        prompt_tokens = prompt_tokens + ?,
        completion_tokens = completion_tokens + ?,
        total_tokens = total_tokens + ?,
        cache_hit_tokens = cache_hit_tokens + ?,
        cache_miss_tokens = cache_miss_tokens + ?
      WHERE session_id = ?
    `).run(
      usage.promptTokens, usage.completionTokens, usage.totalTokens,
      usage.cacheHitTokens, usage.cacheMissTokens, sessionId,
    );
  }

  renameSession(sessionId: string, name: string): void {
    this.db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, sessionId);
  }

  forkSession(sessionId: string, newName: string): Session | null {
    const original = this.getSession(sessionId);
    if (!original) return null;

    const forked = this.createSession(newName, original.model, original.mode, sessionId);

    // Copy messages
    for (const msg of original.messages) {
      this.addMessage(forked.id, msg);
    }

    return this.getSession(forked.id);
  }

  close(): void {
    this.db.close();
  }
}
