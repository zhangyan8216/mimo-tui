// src/tools/database.ts - Database query tool for SQLite

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import type { Tool, ToolContext } from './registry.js';

const MAX_ROWS = 100;
const MAX_OUTPUT = 80_000; // 80KB

/** Try to load better-sqlite3 at runtime */
let BetterSqlite3: typeof import('better-sqlite3') | null = null;
try {
  const mod = await import('better-sqlite3');
  BetterSqlite3 = mod.default;
} catch {
  // better-sqlite3 not available, will fall back to CLI
}

/** Format rows as an ASCII table */
function formatTable(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '（空结果集）';

  // Calculate column widths
  const widths = columns.map((col, i) => {
    const maxData = rows.reduce((max, row) => {
      const val = row[i] === null ? 'NULL' : String(row[i]);
      return Math.max(max, val.length);
    }, 0);
    return Math.max(col.length, Math.min(maxData, 60));
  });

  const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
  const header = columns.map((col, i) => ` ${col.padEnd(widths[i])} `).join('|');

  const lines = [header, sep];
  for (const row of rows) {
    const line = row.map((val, i) => {
      const str = val === null ? 'NULL' : String(val);
      const truncated = str.length > 60 ? str.slice(0, 57) + '...' : str;
      return ` ${truncated.padEnd(widths[i])} `;
    }).join('|');
    lines.push(line);
  }

  return lines.join('\n');
}

/** Use better-sqlite3 for direct queries */
function queryWithLib(dbPath: string, sql: string): string {
  if (!BetterSqlite3) {
    throw new Error('better-sqlite3 not available');
  }

  const db = new BetterSqlite3(dbPath, { readonly: true });
  try {
    const stmt = db.prepare(sql);
    const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(sql);

    if (isSelect) {
      const rows = stmt.all();
      if (rows.length === 0) return '（空结果集）';

      const columns = stmt.columns().map((c: { name: string }) => c.name);
      const dataRows: unknown[][] = rows.map(row =>
        columns.map(col => (row as Record<string, unknown>)[col])
      );

      const truncated = dataRows.length > MAX_ROWS;
      const displayRows = dataRows.slice(0, MAX_ROWS);

      let result = formatTable(columns, displayRows);
      result += `\n\n(${displayRows.length} 行`;
      if (truncated) result += `，显示前 ${MAX_ROWS}/${dataRows.length}`;
      result += ')';

      return result;
    } else {
      const info = stmt.run();
      return `成功（${info.changes} 行受影响）`;
    }
  } finally {
    db.close();
  }
}

/** Fall back to sqlite3 CLI */
function queryWithCli(dbPath: string, sql: string): string {
  const escapedSql = sql.replace(/"/g, '\\"');
  try {
    const result = execSync(
      `sqlite3 -header -column "${dbPath}" "${escapedSql}"`,
      { encoding: 'utf-8', timeout: 30_000, maxBuffer: MAX_OUTPUT }
    );
    return result.trim() || '（空结果集）';
  } catch (err) {
    throw new Error(`sqlite3 CLI error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Execute SQL against the database */
function executeQuery(dbPath: string, sql: string): string {
  if (BetterSqlite3) {
    return queryWithLib(dbPath, sql);
  }
  return queryWithCli(dbPath, sql);
}

/** List all tables in the database */
function listTables(dbPath: string): string {
  return executeQuery(dbPath, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
}

/** Get schema for a specific table */
function getSchema(dbPath: string, table: string): string {
  // Validate table name to prevent injection
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return executeQuery(dbPath, `PRAGMA table_info(${table})`);
}

/** Export data from a table to a file */
function exportData(
  dbPath: string,
  table: string,
  format: string = 'csv'
): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }

  const data = executeQuery(dbPath, `SELECT * FROM ${table}`);

  const tmpDir = path.join(os.tmpdir(), 'mimo-db-export');
  fs.mkdirSync(tmpDir, { recursive: true });

  const baseName = path.basename(dbPath, path.extname(dbPath));
  const timestamp = Date.now();

  if (format === 'json') {
    // Export as JSON
    const rows = executeQuery(dbPath, `SELECT * FROM ${table}`);
    const outFile = path.join(tmpDir, `${baseName}_${table}_${timestamp}.json`);

    if (BetterSqlite3) {
      const db = new BetterSqlite3(dbPath, { readonly: true });
      try {
        const stmt = db.prepare(`SELECT * FROM ${table}`);
        const allRows = stmt.all();
        fs.writeFileSync(outFile, JSON.stringify(allRows, null, 2), 'utf-8');
      } finally {
        db.close();
      }
    } else {
      // CLI mode: write raw output as text
      fs.writeFileSync(outFile, JSON.stringify({ raw: rows }), 'utf-8');
    }

    return `已导出到: ${outFile}`;
  }

  if (format === 'table') {
    const outFile = path.join(tmpDir, `${baseName}_${table}_${timestamp}.txt`);
    fs.writeFileSync(outFile, data, 'utf-8');
    return `已导出到: ${outFile}`;
  }

  // Default: CSV export
  if (BetterSqlite3) {
    const db = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const stmt = db.prepare(`SELECT * FROM ${table}`);
      const columns = stmt.columns().map((c: { name: string }) => c.name);
      const rows = stmt.all();

      const csvLines = [columns.join(',')];
      for (const row of rows) {
        const line = columns.map(col => {
          const val = (row as Record<string, unknown>)[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          // Escape CSV values
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',');
        csvLines.push(line);
      }

      const outFile = path.join(tmpDir, `${baseName}_${table}_${timestamp}.csv`);
      fs.writeFileSync(outFile, csvLines.join('\n'), 'utf-8');
      return `已导出 ${rows.length} 行到: ${outFile}`;
    } finally {
      db.close();
    }
  }

  // CLI CSV mode
  const outFile = path.join(tmpDir, `${baseName}_${table}_${timestamp}.csv`);
  try {
    execSync(
      `sqlite3 -header -csv "${dbPath}" "SELECT * FROM ${table}" > "${outFile}"`,
      { timeout: 30_000 }
    );
    return `已导出到: ${outFile}`;
  } catch (err) {
    throw new Error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const databaseTool: Tool = {
  name: 'database',
  description: '数据库操作工具。支持 SQLite 查询、数据库结构查看、数据导出。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['query', 'tables', 'schema', 'export'],
        description: 'query: 执行SQL查询, tables: 列出所有表, schema: 查看表结构, export: 导出数据为CSV',
      },
      db_path: {
        type: 'string',
        description: '数据库文件路径。示例: "data/app.db"',
      },
      sql: {
        type: 'string',
        description: 'SQL 查询语句 (query action 必填)',
      },
      table: {
        type: 'string',
        description: '表名 (schema/export action)',
      },
      format: {
        type: 'string',
        enum: ['csv', 'json', 'table'],
        description: '输出格式 (export action)',
      },
    },
    required: ['action', 'db_path'],
  },
  requiresApproval: true,

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(args.action);
    const dbPath = String(args.db_path);

    // Resolve relative paths against cwd
    const resolvedPath = path.resolve(process.cwd(), dbPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Database file not found: ${resolvedPath}`);
    }

    switch (action) {
      case 'query': {
        const sql = String(args.sql || '');
        if (!sql) {
          throw new Error('SQL query is required for query action');
        }
        // Block dangerous statements in read-only context
        const normalized = sql.trim().toUpperCase();
        if (/^\s*(DROP|ALTER|CREATE|ATTACH|DETACH)\b/.test(normalized)) {
          throw new Error('DDL statements (DROP/ALTER/CREATE) are not allowed. Use shell tool for schema changes.');
        }
        return executeQuery(resolvedPath, sql);
      }

      case 'tables':
        return listTables(resolvedPath);

      case 'schema': {
        const table = String(args.table || '');
        if (!table) {
          throw new Error('Table name is required for schema action');
        }
        return getSchema(resolvedPath, table);
      }

      case 'export': {
        const table = String(args.table || '');
        if (!table) {
          throw new Error('Table name is required for export action');
        }
        const format = String(args.format || 'csv');
        return exportData(resolvedPath, table, format);
      }

      default:
        throw new Error(`Unknown action: ${action}. Use: query, tables, schema, export`);
    }
  },
};
