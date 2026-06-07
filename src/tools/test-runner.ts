// src/tools/test-runner.ts - Detect and run project tests

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool, ToolContext } from './registry.js';

interface TestDetection {
  framework: string;
  command: string;
  configFiles: string[];
}

/** Detect test framework and command from the project */
function detectTestFramework(cwd: string): TestDetection | null {
  const hasFile = (f: string) => fs.existsSync(path.join(cwd, f));

  // 1. Check package.json for test scripts
  if (hasFile('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      const scripts = pkg.scripts || {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Detect from config files first (most specific)
      if (hasFile('vitest.config.ts') || hasFile('vitest.config.js') || hasFile('vitest.config.mts') || deps?.vitest) {
        const scriptCmd = scripts['test'] || 'vitest run';
        return {
          framework: 'vitest',
          command: scriptCmd,
          configFiles: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'],
        };
      }

      if (hasFile('jest.config.ts') || hasFile('jest.config.js') || hasFile('jest.config.mjs') || hasFile('jest.config.cjs') || deps?.jest) {
        const scriptCmd = scripts['test'] || 'jest';
        return {
          framework: 'jest',
          command: scriptCmd,
          configFiles: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs'],
        };
      }

      if (hasFile('.mocharc.yml') || hasFile('.mocharc.js') || hasFile('.mocharc.cjs') || deps?.mocha) {
        return {
          framework: 'mocha',
          command: scripts['test'] || 'mocha',
          configFiles: ['.mocharc.yml', '.mocharc.js', '.mocharc.cjs'],
        };
      }

      // Fallback: use "test" script if present
      if (scripts['test']) {
        return {
          framework: 'npm test',
          command: 'npm test',
          configFiles: ['package.json'],
        };
      }
    } catch {
      // malformed package.json, continue
    }
  }

  // 2. Python: pytest
  if (hasFile('pytest.ini') || hasFile('pyproject.toml') || hasFile('setup.cfg') || hasFile('conftest.py')) {
    const configFiles: string[] = [];
    if (hasFile('pytest.ini')) configFiles.push('pytest.ini');
    if (hasFile('conftest.py')) configFiles.push('conftest.py');

    // Check pyproject.toml for [tool.pytest]
    if (hasFile('pyproject.toml')) {
      configFiles.push('pyproject.toml');
    }

    if (configFiles.length > 0 || hasFile('tests') || hasFile('test_*.py')) {
      return {
        framework: 'pytest',
        command: 'pytest',
        configFiles,
      };
    }
  }

  // 3. Go
  if (hasFile('go.mod')) {
    return {
      framework: 'go test',
      command: 'go test ./...',
      configFiles: ['go.mod'],
    };
  }

  // 4. Rust
  if (hasFile('Cargo.toml')) {
    return {
      framework: 'cargo test',
      command: 'cargo test',
      configFiles: ['Cargo.toml'],
    };
  }

  return null;
}

interface TestResults {
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  errors: number | null;
  total: number | null;
  duration: string | null;
  exitCode: number;
  success: boolean;
  rawOutput: string;
  errorOutput: string;
  framework: string;
  command: string;
}

/** Parse test output for common result patterns */
function parseTestResults(stdout: string, stderr: string, exitCode: number, framework: string): Omit<TestResults, 'exitCode' | 'rawOutput' | 'errorOutput' | 'framework' | 'command'> {
  const combined = stdout + '\n' + stderr;
  let passed: number | null = null;
  let failed: number | null = null;
  let skipped: number | null = null;
  let errors: number | null = null;
  let duration: string | null = null;

  // Jest / Vitest: "Tests: 2 failed, 12 passed, 14 total"
  const jestMatch = combined.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/i);
  if (jestMatch) {
    failed = jestMatch[1] ? parseInt(jestMatch[1]) : 0;
    passed = jestMatch[2] ? parseInt(jestMatch[2]) : (jestMatch[3] ? parseInt(jestMatch[3]) - (failed || 0) : null);
    const total = parseInt(jestMatch[3]);
    if (passed === null && failed !== null) passed = total - failed;
    return { passed, failed, skipped, errors, total, duration, success: exitCode === 0 && (failed === 0 || failed === null) };
  }

  // Jest: "X passing", "Y failing"
  const jestPassMatch = combined.match(/(\d+)\s+passing/);
  const jestFailMatch = combined.match(/(\d+)\s+failing/);
  if (jestPassMatch || jestFailMatch) {
    passed = jestPassMatch ? parseInt(jestPassMatch[1]) : 0;
    failed = jestFailMatch ? parseInt(jestFailMatch[1]) : 0;
    return { passed, failed, skipped, errors, total: passed + failed, duration, success: failed === 0 };
  }

  // pytest: "X passed, Y failed, Z skipped in 0.12s"
  const pytestMatch = combined.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?(?:,\s+(\d+)\s+error)?/i);
  if (pytestMatch) {
    passed = parseInt(pytestMatch[1]);
    failed = pytestMatch[2] ? parseInt(pytestMatch[2]) : 0;
    skipped = pytestMatch[3] ? parseInt(pytestMatch[3]) : 0;
    errors = pytestMatch[4] ? parseInt(pytestMatch[4]) : 0;
    return { passed, failed, skipped, errors, total: passed + (failed || 0) + (skipped || 0), duration, success: failed === 0 && errors === 0 };
  }

  // pytest short: "X failed, Y passed"
  const pytestShort = combined.match(/(\d+)\s+failed,\s+(\d+)\s+passed/i);
  if (pytestShort) {
    failed = parseInt(pytestShort[1]);
    passed = parseInt(pytestShort[2]);
    return { passed, failed, skipped, errors, total: passed + failed, duration, success: failed === 0 };
  }

  // Go test: "ok  	package/path	0.123s" / "FAIL package/path"
  const goOkMatch = combined.match(/ok\s+\S+\s+([\d.]+s)/);
  const goFailMatch = combined.match(/FAIL\s/g);
  if (goOkMatch || goFailMatch) {
    const okCount = (combined.match(/ok\s+\S+/g) || []).length;
    const failCount = (combined.match(/FAIL\s+\S+/g) || []).length;
    passed = okCount;
    failed = failCount;
    if (goOkMatch) duration = goOkMatch[1];
    return { passed, failed, skipped, errors, total: okCount + failCount, duration, success: failCount === 0 };
  }

  // Cargo test: "test result: ok. X passed; Y failed; Z ignored"
  const cargoMatch = combined.match(/test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/);
  if (cargoMatch) {
    passed = parseInt(cargoMatch[1]);
    failed = parseInt(cargoMatch[2]);
    skipped = parseInt(cargoMatch[3]);
    return { passed, failed, skipped, errors, total: passed + failed + skipped, duration, success: failed === 0 };
  }

  // Generic: "X tests, Y passed, Z failed"
  const genericMatch = combined.match(/(\d+)\s+tests?,\s+(\d+)\s+passed,\s+(\d+)\s+failed/i);
  if (genericMatch) {
    passed = parseInt(genericMatch[2]);
    failed = parseInt(genericMatch[3]);
    return { passed, failed, skipped, errors, total: parseInt(genericMatch[1]), duration, success: failed === 0 };
  }

  // Duration patterns
  const durationMatch = combined.match(/(?:Time|Duration|took|elapsed)[:\s]+([\d.]+s|\d+:\d+[\d.]*)/i);
  if (durationMatch) duration = durationMatch[1];

  // If nothing matched, use exit code as indicator
  return { passed: null, failed: null, skipped: null, errors: null, total: null, duration, success: exitCode === 0 };
}

/** Format a human-readable summary */
function formatResults(results: TestResults): string {
  const lines: string[] = [];
  const statusIcon = results.success ? '[通过]' : '[失败]';

  lines.push(`${statusIcon} 测试结果（${results.framework}）`);
  lines.push(`命令: ${results.command}`);
  lines.push('');

  if (results.total !== null) {
    const parts: string[] = [];
    if (results.passed !== null && results.passed > 0) parts.push(`${results.passed} 通过`);
    if (results.failed !== null && results.failed > 0) parts.push(`${results.failed} 失败`);
    if (results.skipped !== null && results.skipped > 0) parts.push(`${results.skipped} 跳过`);
    if (results.errors !== null && results.errors > 0) parts.push(`${results.errors} 错误`);
    lines.push(`结果: ${parts.join(', ') || '未找到测试'}（共 ${results.total} 个）`);
  }

  if (results.duration) {
    lines.push(`耗时: ${results.duration}`);
  }

  lines.push(`退出码: ${results.exitCode}`);

  return lines.join('\n');
}

const MAX_OUTPUT = 50_000; // 50KB

export const testRunnerTool: Tool = {
  name: 'test_runner',
  description: '自动检测并运行项目测试。支持 jest/vitest/mocha/pytest/go test/cargo test。返回测试结果摘要（通过/失败/跳过数量）。修改代码后应运行测试验证。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '自定义测试命令（覆盖自动检测）。示例: "npm run test:unit"',
      },
      pattern: {
        type: 'string',
        description: '测试文件过滤模式。示例: "auth.spec.ts", "*.test.js"',
      },
      verbose: {
        type: 'boolean',
        description: '是否返回完整测试输出。默认只返回摘要',
      },
    },
    required: [],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const explicitCommand = args.command ? String(args.command) : undefined;
    const pattern = args.pattern ? String(args.pattern) : undefined;
    const verbose = args.verbose === true;
    const isWindows = os.platform() === 'win32';

    // Detect or use explicit command
    let detection: TestDetection | null = null;
    let command: string;

    if (explicitCommand) {
      command = explicitCommand;
      detection = { framework: 'custom', command, configFiles: [] };
    } else {
      detection = detectTestFramework(ctx.cwd);
      if (!detection) {
        return '未检测到测试框架。支持: jest, vitest, mocha, pytest, go test, cargo test。可通过 "command" 参数自定义测试命令。';
      }
      command = detection.command;
    }

    // Append pattern filter if provided
    if (pattern) {
      if (detection.framework === 'jest' || detection.framework === 'npm test') {
        command += ` --testPathPattern="${pattern}"`;
      } else if (detection.framework === 'vitest') {
        command += ` ${pattern}`;
      } else if (detection.framework === 'mocha') {
        command += ` --grep "${pattern}"`;
      } else if (detection.framework === 'pytest') {
        command += ` -k "${pattern}"`;
      } else {
        command += ` ${pattern}`;
      }
    }

    const timeout = 120_000; // 2 minutes

    return new Promise<string>((resolve, reject) => {
      const shell = isWindows ? 'powershell' : 'bash';
      const shellArgs = isWindows
        ? ['-NoProfile', '-NonInteractive', '-Command', `try { ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { Write-Error $_; exit 1 }`]
        : ['-c', command];

      const proc = spawn(shell, shellArgs, {
        cwd: ctx.cwd,
        env: { ...process.env, CI: 'true' }, // CI=true makes some test runners non-interactive
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT) + '\n... (output truncated at 50KB)';
          proc.kill();
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT) {
          stderr = stderr.slice(0, MAX_OUTPUT) + '\n... (stderr truncated at 50KB)';
          proc.kill();
        }
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`测试命令执行超时（${timeout}ms）`));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const exitCode = code ?? 1;

        const parsed = parseTestResults(stdout, stderr, exitCode, detection!.framework);
        const results: TestResults = {
          ...parsed,
          exitCode,
          success: exitCode === 0,
          rawOutput: stdout,
          errorOutput: stderr,
          framework: detection!.framework,
          command,
        };

        const summary = formatResults(results);

        if (verbose) {
          const parts = [summary];
          if (stdout.trim()) {
            parts.push('\n--- 标准输出 ---');
            parts.push(stdout.trimEnd().slice(-30_000)); // last 30KB for verbose
          }
          if (stderr.trim()) {
            parts.push('\n--- 错误输出 ---');
            parts.push(stderr.trimEnd().slice(-10_000));
          }
          resolve(parts.join('\n'));
        } else {
          // In non-verbose mode, still include stderr if tests failed (usually has error details)
          if (!results.success && stderr.trim()) {
            resolve(`${summary}\n\n--- 错误输出（前 2KB）---\n${stderr.trimEnd().slice(0, 2_000)}`);
          } else {
            resolve(summary);
          }
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`运行测试命令失败：${err.message}`));
      });
    });
  },
};
