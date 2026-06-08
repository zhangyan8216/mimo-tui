import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CommandHistory } from '../history.js';

const tmpRoot = path.join(os.tmpdir(), `mimo-test-history-${process.pid}`);
const originalMimoHome = process.env.MIMO_HOME;

function resetHistoryHome(testName: string): string {
  const safeName = testName.replace(/[^a-z0-9_-]/gi, '_');
  const mimoHome = path.join(tmpRoot, safeName);
  fs.rmSync(mimoHome, { recursive: true, force: true });
  fs.mkdirSync(mimoHome, { recursive: true });
  process.env.MIMO_HOME = mimoHome;
  return path.join(mimoHome, 'history.json');
}

describe('CommandHistory', () => {
  beforeEach((ctx) => {
    resetHistoryHome(ctx.task.name);
  });

  afterEach(() => {
    if (originalMimoHome === undefined) delete process.env.MIMO_HOME;
    else process.env.MIMO_HOME = originalMimoHome;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('starts with empty history when no file exists', () => {
    const history = new CommandHistory();
    expect(history.getAll()).toEqual([]);
  });

  it('adds entries and returns them via getAll', () => {
    const history = new CommandHistory();
    history.add('first command');
    history.add('second command');
    expect(history.getAll()).toEqual(['first command', 'second command']);
  });

  it('deduplicates consecutive identical entries', () => {
    const history = new CommandHistory();
    history.add('same');
    history.add('same');
    history.add('different');
    history.add('different');
    expect(history.getAll()).toEqual(['same', 'different']);
  });

  it('does NOT deduplicate non-consecutive identical entries', () => {
    const history = new CommandHistory();
    history.add('command A');
    history.add('command B');
    history.add('command A');
    expect(history.getAll()).toEqual(['command A', 'command B', 'command A']);
  });

  it('enforces max limit of 200 entries', () => {
    const history = new CommandHistory();
    for (let i = 0; i < 210; i++) {
      history.add(`command ${i}`);
    }
    const all = history.getAll();
    expect(all.length).toBe(200);
    expect(all[0]).toBe('command 10');
    expect(all[199]).toBe('command 209');
  });

  it('up() navigates backwards through history', () => {
    const history = new CommandHistory();
    history.add('first');
    history.add('second');
    history.add('third');

    expect(history.up()).toBe('third');
    expect(history.up()).toBe('second');
    expect(history.up()).toBe('first');
    expect(history.up()).toBe('first');
  });

  it('down() navigates forwards through history', () => {
    const history = new CommandHistory();
    history.add('first');
    history.add('second');

    history.up();
    history.up();
    expect(history.down()).toBe('second');
    expect(history.down()).toBeNull();
  });

  it('up() returns null on empty history', () => {
    const history = new CommandHistory();
    expect(history.up()).toBeNull();
  });

  it('down() returns null on empty history', () => {
    const history = new CommandHistory();
    expect(history.down()).toBeNull();
  });

  it('search() finds matching entries', () => {
    const history = new CommandHistory();
    history.add('git status');
    history.add('npm test');
    history.add('git push');
    history.add('ls -la');

    expect(history.search('git')).toEqual(['git push', 'git status']);
  });

  it('search() is case insensitive', () => {
    const history = new CommandHistory();
    history.add('Git Status');
    history.add('NPM Test');

    expect(history.search('git')).toEqual(['Git Status']);
    expect(history.search('NPM')).toEqual(['NPM Test']);
  });

  it('reset() resets navigation index', () => {
    const history = new CommandHistory();
    history.add('first');
    history.add('second');

    history.up();
    history.up();
    history.reset();
    expect(history.up()).toBe('second');
  });

  it('persists to disk and loads on new instance', () => {
    const historyFile = resetHistoryHome('persists to disk and loads on new instance');
    const history1 = new CommandHistory();
    history1.add('persisted cmd 1');
    history1.add('persisted cmd 2');

    expect(fs.existsSync(historyFile)).toBe(true);
    const history2 = new CommandHistory();
    expect(history2.getAll()).toEqual(['persisted cmd 1', 'persisted cmd 2']);
  });

  it('ignores malformed persisted history', () => {
    const historyFile = resetHistoryHome('ignores malformed persisted history');
    fs.writeFileSync(historyFile, '{"not":"an array"}', 'utf-8');

    const history = new CommandHistory();
    expect(history.getAll()).toEqual([]);
  });
});
