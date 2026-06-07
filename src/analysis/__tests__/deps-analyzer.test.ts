// src/analysis/__tests__/deps-analyzer.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { analyzeDependencies, formatDepAnalysis } from '../deps-analyzer.js';
import type { DepAnalysis } from '../deps-analyzer.js';

describe('analyzeDependencies', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty analysis when no package.json exists', () => {
    const result = analyzeDependencies(tmpDir);
    expect(result).toEqual({
      declared: { deps: [], devDeps: [] },
      used: [],
      unused: [],
      undeclared: [],
    });
  });

  it('analyzes dependencies from a mock project', () => {
    const subDir = path.join(tmpDir, 'mock-project');
    fs.mkdirSync(subDir, { recursive: true });

    // Create package.json with some deps
    fs.writeFileSync(
      path.join(subDir, 'package.json'),
      JSON.stringify({
        dependencies: { lodash: '^4.0.0', express: '^4.0.0' },
        devDependencies: { vitest: '^1.0.0' },
      }),
    );

    // Create a source file that uses lodash but not express
    fs.mkdirSync(path.join(subDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(subDir, 'src', 'index.ts'),
      `import _ from 'lodash';\nimport { something } from './local';\nconsole.log(_.isEmpty({}));`,
    );

    const result = analyzeDependencies(subDir);
    expect(result.declared.deps).toEqual(expect.arrayContaining(['lodash', 'express']));
    expect(result.declared.devDeps).toEqual(['vitest']);
    expect(result.used).toContain('lodash');
    expect(result.unused).toContain('express');
    expect(result.unused).toContain('vitest');
    expect(result.undeclared).toEqual([]);
  });

  it('detects undeclared dependencies', () => {
    const subDir = path.join(tmpDir, 'undeclared-project');
    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(path.join(subDir, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(subDir, 'package.json'),
      JSON.stringify({ dependencies: {} }),
    );

    fs.writeFileSync(
      path.join(subDir, 'src', 'app.ts'),
      `import axios from 'axios';\nconsole.log(axios);`,
    );

    const result = analyzeDependencies(subDir);
    expect(result.undeclared).toContain('axios');
  });

  it('handles scoped packages correctly', () => {
    const subDir = path.join(tmpDir, 'scoped-project');
    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(path.join(subDir, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(subDir, 'package.json'),
      JSON.stringify({
        dependencies: { '@anthropic/sdk': '^1.0.0' },
      }),
    );

    fs.writeFileSync(
      path.join(subDir, 'src', 'app.ts'),
      `import sdk from '@anthropic/sdk';\nconsole.log(sdk);`,
    );

    const result = analyzeDependencies(subDir);
    expect(result.used).toContain('@anthropic/sdk');
    expect(result.unused).toEqual([]);
  });

  it('ignores node builtins', () => {
    const subDir = path.join(tmpDir, 'builtin-project');
    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(path.join(subDir, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(subDir, 'package.json'),
      JSON.stringify({ dependencies: {} }),
    );

    fs.writeFileSync(
      path.join(subDir, 'src', 'app.ts'),
      `import fs from 'fs';\nimport path from 'path';`,
    );

    const result = analyzeDependencies(subDir);
    expect(result.used).not.toContain('fs');
    expect(result.used).not.toContain('path');
    expect(result.undeclared).toEqual([]);
  });
});

describe('formatDepAnalysis', () => {
  it('formats analysis with no issues', () => {
    const analysis: DepAnalysis = {
      declared: { deps: ['lodash'], devDeps: [] },
      used: ['lodash'],
      unused: [],
      undeclared: [],
    };
    const output = formatDepAnalysis(analysis);
    expect(output).toContain('依赖分析');
    expect(output).toContain('已声明: 1 个依赖 + 0 个开发依赖');
    expect(output).toContain('实际使用: 1 个包');
    expect(output).toContain('依赖状态良好');
  });

  it('formats analysis with unused deps', () => {
    const analysis: DepAnalysis = {
      declared: { deps: ['lodash', 'express'], devDeps: ['jest'] },
      used: ['lodash'],
      unused: ['express', 'jest'],
      undeclared: [],
    };
    const output = formatDepAnalysis(analysis);
    expect(output).toContain('未使用的依赖');
    expect(output).toContain('express');
    expect(output).toContain('jest (devDep)');
  });

  it('formats analysis with undeclared deps', () => {
    const analysis: DepAnalysis = {
      declared: { deps: [], devDeps: [] },
      used: ['axios'],
      unused: [],
      undeclared: ['axios'],
    };
    const output = formatDepAnalysis(analysis);
    expect(output).toContain('未声明的依赖');
    expect(output).toContain('axios');
    expect(output).toContain('npm install axios');
  });
});
