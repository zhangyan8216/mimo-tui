// src/utils/logger.ts - Production-grade logging with rotation

import fs from 'fs';
import path from 'path';
import { getMimoPath } from './paths.js';

const MAX_LOG_FILES = 10;
let logStream: fs.WriteStream | null = null;
let debugEnabled = false;

function getLogDir(): string {
  return getMimoPath('logs');
}

export function initLogger(debug: boolean): void {
  debugEnabled = debug;

  // Always create log directory for rotation cleanup
  const logDir = getLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  rotateLogs();

  if (debug) {
    const logFile = path.join(logDir, `mimo-${Date.now()}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
  }
}

/** Keep only the most recent N log files */
function rotateLogs(): void {
  const logDir = getLogDir();
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('mimo-') && f.endsWith('.log'))
      .map(f => ({ name: f, time: fs.statSync(path.join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    // Remove old files beyond MAX_LOG_FILES
    for (const file of files.slice(MAX_LOG_FILES)) {
      try { fs.unlinkSync(path.join(logDir, file.name)); } catch { /* ignore */ }
    }
  } catch { /* ignore rotation errors */ }
}

export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown): void {
  if (level === 'debug' && !debugEnabled) return;

  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : '';
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

  // Write to debug log file if open
  if (logStream) {
    logStream.write(line);
  }

  // Always write errors and warnings to stderr
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  }
}

export function closeLogger(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}
