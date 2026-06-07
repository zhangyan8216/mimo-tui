// src/tools/__tests__/database.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { ToolContext } from '../registry.js';

const tmpDir = path.join(os.tmpdir(), 'mimo-test-database');
let dbPath: string;

function makeCtx(): ToolContext {
  return {
    cwd: tmpDir,
    workingDirectory: tmpDir,
    sandbox: {
      validatePath: () => ({ allowed: true, resolved: tmpDir }),
    },
  } as unknown as ToolContext;
}

const ctx = makeCtx();

// We need to dynamically import the tool to avoid top-level await issues
let databaseTool: typeof import('../database.js').databaseTool;

beforeAll(async () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  dbPath = path.join(tmpDir, 'test.db');

  // Create a test SQLite database
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      age INTEGER
    );
    INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 30);
    INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@example.com', 25);
    INSERT INTO users (name, email, age) VALUES ('Charlie', 'charlie@example.com', 35);

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      user_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    INSERT INTO posts (title, user_id) VALUES ('Hello World', 1);
    INSERT INTO posts (title, user_id) VALUES ('Second Post', 2);
  `);
  db.close();

  // Import the tool after creating the db
  const mod = await import('../database.js');
  databaseTool = mod.databaseTool;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('database tool', () => {
  it('has correct tool name', () => {
    expect(databaseTool.name).toBe('database');
  });

  it('has requiresApproval set to true', () => {
    expect(databaseTool.requiresApproval).toBe(true);
  });

  it('has action and db_path as required parameters', () => {
    expect(databaseTool.parameters.required).toContain('action');
    expect(databaseTool.parameters.required).toContain('db_path');
  });

  it('throws when db file does not exist', async () => {
    await expect(
      databaseTool.execute(
        { action: 'tables', db_path: path.join(tmpDir, 'nonexistent.db') },
        ctx,
      ),
    ).rejects.toThrow('Database file not found');
  });

  describe('tables action', () => {
    it('lists all tables', async () => {
      const result = await databaseTool.execute(
        { action: 'tables', db_path: dbPath },
        ctx,
      );
      expect(result).toContain('users');
      expect(result).toContain('posts');
    });
  });

  describe('schema action', () => {
    it('shows column info for a table', async () => {
      const result = await databaseTool.execute(
        { action: 'schema', db_path: dbPath, table: 'users' },
        ctx,
      );
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('email');
      expect(result).toContain('age');
    });

    it('throws when table name is missing', async () => {
      await expect(
        databaseTool.execute(
          { action: 'schema', db_path: dbPath },
          ctx,
        ),
      ).rejects.toThrow('Table name is required');
    });

    it('throws for invalid table name', async () => {
      await expect(
        databaseTool.execute(
          { action: 'schema', db_path: dbPath, table: 'users; DROP TABLE users' },
          ctx,
        ),
      ).rejects.toThrow('Invalid table name');
    });
  });

  describe('query action', () => {
    it('returns query results', async () => {
      const result = await databaseTool.execute(
        { action: 'query', db_path: dbPath, sql: 'SELECT name, age FROM users ORDER BY age' },
        ctx,
      );
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
      expect(result).toContain('Charlie');
      expect(result).toContain('行');
    });

    it('throws when sql is missing', async () => {
      await expect(
        databaseTool.execute(
          { action: 'query', db_path: dbPath },
          ctx,
        ),
      ).rejects.toThrow('SQL query is required');
    });

    it('blocks DROP statements', async () => {
      await expect(
        databaseTool.execute(
          { action: 'query', db_path: dbPath, sql: 'DROP TABLE users' },
          ctx,
        ),
      ).rejects.toThrow('DDL statements');
    });

    it('blocks ALTER statements', async () => {
      await expect(
        databaseTool.execute(
          { action: 'query', db_path: dbPath, sql: 'ALTER TABLE users ADD COLUMN phone TEXT' },
          ctx,
        ),
      ).rejects.toThrow('DDL statements');
    });

    it('blocks CREATE statements', async () => {
      await expect(
        databaseTool.execute(
          { action: 'query', db_path: dbPath, sql: 'CREATE TABLE test (id INTEGER)' },
          ctx,
        ),
      ).rejects.toThrow('DDL statements');
    });

    it('allows SELECT queries with WHERE', async () => {
      const result = await databaseTool.execute(
        { action: 'query', db_path: dbPath, sql: "SELECT * FROM users WHERE name = 'Alice'" },
        ctx,
      );
      expect(result).toContain('Alice');
      expect(result).toContain('alice@example.com');
    });
  });

  describe('export action', () => {
    it('exports data as CSV', async () => {
      const result = await databaseTool.execute(
        { action: 'export', db_path: dbPath, table: 'users', format: 'csv' },
        ctx,
      );
      expect(result).toContain('已导出');
      expect(result).toContain('.csv');

      // Verify the file exists and has content
      const match = result.match(/已导出.*?到: (.+)$/m);
      expect(match).toBeTruthy();
      const filePath = match![1].trim();
      expect(fs.existsSync(filePath)).toBe(true);
      const csvContent = fs.readFileSync(filePath, 'utf-8');
      expect(csvContent).toContain('Alice');
      expect(csvContent).toContain('Bob');
    });

    it('exports data as JSON', async () => {
      const result = await databaseTool.execute(
        { action: 'export', db_path: dbPath, table: 'users', format: 'json' },
        ctx,
      );
      expect(result).toContain('已导出');
      expect(result).toContain('.json');

      const match = result.match(/已导出.*?到: (.+)$/m);
      expect(match).toBeTruthy();
      const filePath = match![1].trim();
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('throws when table name is missing', async () => {
      await expect(
        databaseTool.execute(
          { action: 'export', db_path: dbPath },
          ctx,
        ),
      ).rejects.toThrow('Table name is required');
    });
  });

  it('throws for unknown action', async () => {
    await expect(
      databaseTool.execute(
        { action: 'unknown', db_path: dbPath },
        ctx,
      ),
    ).rejects.toThrow('Unknown action');
  });
});
