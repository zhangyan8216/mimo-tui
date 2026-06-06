// src/utils/logger.ts - Debug logging utility

import fs from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.mimo', 'logs');
let logStream: fs.WriteStream | null = null;
let debugEnabled = false;

export function initLogger(debug: boolean): void {
  debugEnabled = debug;
  if (debug) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `mimo-${Date.now()}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
  }
}

export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown): void {
  if (level === 'debug' && !debugEnabled) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;

  if (logStream) {
    logStream.write(line);
  }

  if (level === 'error') {
    process.stderr.write(line);
  }
}

export function closeLogger(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}
