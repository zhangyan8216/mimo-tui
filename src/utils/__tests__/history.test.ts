// src/utils/__tests__/history.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the history file path to use a temp directory
const tmpDir = path.join(os.tmpdir(), 'mimo-test-history');
const historyFile = path.join(tmpDir, 'history.json');

// We need to intercept the module's HISTORY_FILE constant.
// Since it's computed at import time using os.homedir(), we mock fs operations instead.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    // We'll let the real fs work, but we need to handle the homedir-based path.
    // Instead, we'll use a different approach: mock os.homedir.
  };
});

import { CommandHistory } from '../history.js';

// Since the history file path is computed from os.homedir() at module load time,
// we need to clean up the actual history file if it exists, or mock more aggressively.
// Let's use a pragmatic approach: create a CommandHistory and clean up after.
const actualHistoryFile = path.join(os.homedir(), '.mimo', 'history.json');

describe('CommandHistory', () => {
  let originalHistory: string | null = null;

  beforeEach(() => {
    // Backup existing history
    try {
      if (fs.existsSync(actualHistoryFile)) {
        originalHistory = fs.readFileSync(actualHistoryFile, 'utf-8');
      }
    } catch {
      originalHistory = null;
    }
    // Clear history file for clean test
    try {
      if (fs.existsSync(actualHistoryFile)) {
        fs.writeFileSync(actualHistoryFile, '[]', 'utf-8');
      }
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    // Restore original history
    try {
      if (originalHistory !== null) {
        fs.mkdirSync(path.dirname(actualHistoryFile), { recursive: true });
        fs.writeFileSync(actualHistoryFile, originalHistory, 'utf-8');
      } else if (fs.existsSync(actualHistoryFile)) {
        fs.unlinkSync(actualHistoryFile);
      }
    } catch {
      // ignore
    }
  });

  it('starts with empty history when no file exists', () => {
    // Create a fresh history after clearing the file
    try {
      if (fs.existsSync(actualHistoryFile)) {
        fs.writeFileSync(actualHistoryFile, '[]', 'utf-8');
      }
    } catch { /* ignore */ }

    const history = new CommandHistory();
    expect(history.getAll()).toEqual([]);
  });

  it('adds entries and returns them via getAll', () => {
    // Clear file first
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('first command');
    history.add('second command');
    const all = history.getAll();
    expect(all).toEqual(['first command', 'second command']);
  });

  it('deduplicates consecutive identical entries', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('same');
    history.add('same');
    history.add('different');
    history.add('different');
    expect(history.getAll()).toEqual(['same', 'different']);
  });

  it('does NOT deduplicate non-consecutive identical entries', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('command A');
    history.add('command B');
    history.add('command A');
    expect(history.getAll()).toEqual(['command A', 'command B', 'command A']);
  });

  it('enforces max limit of 200 entries', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    for (let i = 0; i < 210; i++) {
      history.add(`command ${i}`);
    }
    const all = history.getAll();
    expect(all.length).toBe(200);
    // Should keep the last 200
    expect(all[0]).toBe('command 10');
    expect(all[199]).toBe('command 209');
  });

  it('up() navigates backwards through history', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('first');
    history.add('second');
    history.add('third');

    expect(history.up()).toBe('third');
    expect(history.up()).toBe('second');
    expect(history.up()).toBe('first');
    // Clamps at 0
    expect(history.up()).toBe('first');
  });

  it('down() navigates forwards through history', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('first');
    history.add('second');

    history.up();
    history.up();
    expect(history.down()).toBe('second');
    expect(history.down()).toBeNull(); // past the end
  });

  it('up() returns null on empty history', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    expect(history.up()).toBeNull();
  });

  it('down() returns null on empty history', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    expect(history.down()).toBeNull();
  });

  it('search() finds matching entries', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('git status');
    history.add('npm test');
    history.add('git push');
    history.add('ls -la');

    const results = history.search('git');
    expect(results).toEqual(['git push', 'git status']); // reversed order
  });

  it('search() is case insensitive', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('Git Status');
    history.add('NPM Test');

    expect(history.search('git')).toEqual(['Git Status']);
    expect(history.search('NPM')).toEqual(['NPM Test']);
  });

  it('reset() resets navigation index', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history = new CommandHistory();
    history.add('first');
    history.add('second');

    history.up();
    history.up();
    history.reset();
    // After reset, up() should go to last entry again
    expect(history.up()).toBe('second');
  });

  it('persists to disk and loads on new instance', () => {
    try { fs.writeFileSync(actualHistoryFile, '[]', 'utf-8'); } catch { /* ignore */ }
    const history1 = new CommandHistory();
    history1.add('persisted cmd 1');
    history1.add('persisted cmd 2');

    // Create a new instance - should load from disk
    const history2 = new CommandHistory();
    const all = history2.getAll();
    expect(all).toContain('persisted cmd 1');
    expect(all).toContain('persisted cmd 2');
  });
});
