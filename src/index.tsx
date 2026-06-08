#!/usr/bin/env node
// src/index.tsx - Entry point, CLI args parsing

import React from 'react';
import { render } from 'ink';
import yargsParser from 'yargs-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { App } from './tui/App.js';
import { loadConfig, configExists, saveConfig } from './config.js';
import { initLogger, closeLogger, log } from './utils/logger.js';

// Read version from package.json at runtime
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let APP_VERSION = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  APP_VERSION = pkg.version || '1.0.0';
} catch { /* fallback */ }

// Graceful shutdown handlers
let isShuttingDown = false;
function gracefulShutdown(code: number) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('info', `Shutting down (exit code ${code})`);
  closeLogger();
  process.exit(code);
}

process.on('SIGINT', () => gracefulShutdown(130));
process.on('SIGTERM', () => gracefulShutdown(143));
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', reason);
  // Don't exit — let the process continue, but log it
});
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', err);
  gracefulShutdown(1);
});

const args = yargsParser(process.argv.slice(2), {
  alias: {
    h: 'help',
    v: 'version',
    m: 'model',
    d: 'debug',
  },
  boolean: ['help', 'version', 'debug', 'setup'],
  string: ['model', 'mode'],
});

// Help
if (args.help) {
  console.log(`
  🐱 Mimo TUI - 终端 AI 编程助手

  用法: mimo [选项] [提示词]

  选项:
    -h, --help       显示帮助
    -v, --version    显示版本
    -m, --model      使用的模型（默认: mimo-v2.5-pro）
    -d, --debug      启用调试日志
    --setup          运行设置向导
    --mode           智能体模式: plan, agent, yolo

  斜杠命令（TUI 内部）:
    /new             新建会话
    /mode <mode>     切换模式
    /model <name>    切换模型
    /clear           清屏
    /compact         压缩上下文
    /help            显示帮助

  键盘快捷键:
    Ctrl+K           命令面板
    Ctrl+R           会话列表
    Ctrl+N           新建会话
    Ctrl+L           清屏
    Ctrl+C           取消 / 退出
    F1/?             帮助
  `);
  process.exit(0);
}

// Version
if (args.version) {
  console.log(`mimo-tui v${APP_VERSION}`);
  process.exit(0);
}

// Debug logging
initLogger(Boolean(args.debug));

// Load config
const hasConfig = configExists();
let config = loadConfig();

// Override from CLI args
if (args.model) {
  config.provider.model = args.model;
}
if (args.mode && ['plan', 'agent', 'yolo'].includes(args.mode)) {
  config.agent.mode = args.mode as 'plan' | 'agent' | 'yolo';
}

// Check if setup is needed
const needsSetup = !hasConfig || !config.provider.apiKey || args.setup;

// If a prompt was passed as positional arg, pass it to the app
const prompt = args._.join(' ').trim();

// Render TUI
const { waitUntilExit } = render(
  <App config={config} needsSetup={needsSetup} initialPrompt={prompt || undefined} />
);

// Cleanup on exit
waitUntilExit().then(() => {
  gracefulShutdown(0);
});
