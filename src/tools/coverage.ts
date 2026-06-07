// src/tools/coverage.ts - Test coverage reporting

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool, ToolContext } from './registry.js';

interface CoverageDetection {
  framework: string;
  coverageCommand: string;
  reportCommand: string;
}

/** Detect test framework and coverage tool from the project */
function detectCoverageTool(cwd: string): CoverageDetection | null {
  const hasFile = (f: string) => fs.existsSync(path.join(cwd, f));

  // Check package.json for deps and scripts
  if (hasFile('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Vitest with coverage
      if (hasFile('vitest.config.ts') || hasFile('vitest.config.js') || hasFile('vitest.config.mts') || deps?.vitest) {
        return {
          framework: 'vitest',
          coverageCommand: 'npx vitest run --coverage',
          reportCommand: 'npx vitest run --coverage --reporter=verbose',
        };
      }

      // Jest with coverage
      if (hasFile('jest.config.ts') || hasFile('jest.config.js') || hasFile('jest.config.mjs') || hasFile('jest.config.cjs') || deps?.jest) {
        return {
          framework: 'jest',
          coverageCommand: 'npx jest --coverage',
          reportCommand: 'npx jest --coverage --coverageReporters=text --coverageReporters=text-summary',
        };
      }

      // Fallback: npm test with coverage
      if (pkg.scripts?.['test:coverage']) {
        return {
          framework: 'npm',
          coverageCommand: 'npm run test:coverage',
          reportCommand: 'npm run test:coverage',
        };
      }

      if (pkg.scripts?.['coverage']) {
        return {
          framework: 'npm',
          coverageCommand: 'npm run coverage',
          reportCommand: 'npm run coverage',
        };
      }
    } catch {
      // malformed package.json
    }
  }

  // Python: pytest with coverage
  if (hasFile('pytest.ini') || hasFile('pyproject.toml') || hasFile('setup.cfg') || hasFile('conftest.py')) {
    return {
      framework: 'pytest',
      coverageCommand: 'python -m pytest --cov --cov-report=term-missing',
      reportCommand: 'python -m pytest --cov --cov-report=term-missing --cov-report=html',
    };
  }

  // Go: go test with coverage
  if (hasFile('go.mod')) {
    return {
      framework: 'go',
      coverageCommand: 'go test -coverprofile=coverage.out ./...',
      reportCommand: 'go tool cover -func=coverage.out',
    };
  }

  // Rust: cargo test with coverage (tarpaulin)
  if (hasFile('Cargo.toml')) {
    return {
      framework: 'cargo',
      coverageCommand: 'cargo tarpaulin --out Stdout',
      reportCommand: 'cargo tarpaulin --out Stdout',
    };
  }

  return null;
}

interface CoverageSummary {
  totalStatements: number | null;
  totalBranches: number | null;
  totalFunctions: number | null;
  totalLines: number | null;
  coveredStatements: number | null;
  coveredBranches: number | null;
  coveredFunctions: number | null;
  coveredLines: number | null;
  lineCoverage: string | null;
  framework: string;
  threshold: number | null;
  passesThreshold: boolean;
}

/** Parse coverage output for common coverage patterns */
function parseCoverageOutput(stdout: string, stderr: string, framework: string, threshold: number | null): CoverageSummary {
  const combined = stdout + '\n' + stderr;
  const summary: CoverageSummary = {
    totalStatements: null,
    totalBranches: null,
    totalFunctions: null,
    totalLines: null,
    coveredStatements: null,
    coveredBranches: null,
    coveredFunctions: null,
    coveredLines: null,
    lineCoverage: null,
    framework,
    threshold,
    passesThreshold: true,
  };

  // Jest/Vitest: "|   95.24 |   87.5 |   100 |   95.24 |" or "Stmts   : 95.24%"
  // Also: "All files         |   88.89 |   66.67 |   83.33 |   88.89 |"
  const jestAllFiles = combined.match(/All files\s*\|\s*([\d.]+)\s*\|/);
  if (jestAllFiles) {
    summary.lineCoverage = `${jestAllFiles[1]}%`;
  }

  // Jest/Vitest summary: "Lines      : 95.24% ( 20/21 )"
  const jestLinesMatch = combined.match(/Lines\s*:\s*([\d.]+)%\s*\(?(\d+)\/(\d+)\)?/i);
  if (jestLinesMatch) {
    summary.lineCoverage = `${jestLinesMatch[1]}%`;
    summary.coveredLines = parseInt(jestLinesMatch[2]);
    summary.totalLines = parseInt(jestLinesMatch[3]);
  }

  // Jest/Vitest: "Stmts      : 95.24% ( 20/21 )"
  const jestStmtsMatch = combined.match(/Stmts?\s*:\s*([\d.]+)%\s*\(?(\d+)\/(\d+)\)?/i);
  if (jestStmtsMatch) {
    summary.coveredStatements = parseInt(jestStmtsMatch[2]);
    summary.totalStatements = parseInt(jestStmtsMatch[3]);
  }

  // Jest/Vitest: "Branches   : 87.5% ( 7/8 )"
  const jestBranchesMatch = combined.match(/Branches?\s*:\s*([\d.]+)%\s*\(?(\d+)\/(\d+)\)?/i);
  if (jestBranchesMatch) {
    summary.coveredBranches = parseInt(jestBranchesMatch[2]);
    summary.totalBranches = parseInt(jestBranchesMatch[3]);
  }

  // Jest/Vitest: "Functions  : 100% ( 5/5 )"
  const jestFuncsMatch = combined.match(/Functions?\s*:\s*([\d.]+)%\s*\(?(\d+)\/(\d+)\)?/i);
  if (jestFuncsMatch) {
    summary.coveredFunctions = parseInt(jestFuncsMatch[2]);
    summary.totalFunctions = parseInt(jestFuncsMatch[3]);
  }

  // Generic percentage: "X% coverage" or "Coverage: X%"
  if (!summary.lineCoverage) {
    const genericPercent = combined.match(/(?:coverage|covered)[:\s]+([\d.]+)%/i);
    if (genericPercent) {
      summary.lineCoverage = `${genericPercent[1]}%`;
    }
  }

  // pytest-cov: "TOTAL                     100     20    80%"
  if (framework === 'pytest') {
    const pytestTotal = combined.match(/TOTAL\s+(\d+)\s+(\d+)\s+(\d+)%/);
    if (pytestTotal) {
      summary.totalStatements = parseInt(pytestTotal[1]);
      summary.coveredStatements = parseInt(pytestTotal[1]) - parseInt(pytestTotal[2]);
      summary.lineCoverage = `${pytestTotal[3]}%`;
    }
  }

  // Go: "coverage: 75.0% of statements"
  const goCoverage = combined.match(/coverage:\s+([\d.]+)%\s+of\s+statements/);
  if (goCoverage) {
    summary.lineCoverage = `${goCoverage[1]}%`;
  }

  // Go tool cover -func: "total:\t\t\t(statements)\t75.0%"
  const goFuncCoverage = combined.match(/total:\s+\(statements\)\s+([\d.]+)%/);
  if (goFuncCoverage) {
    summary.lineCoverage = `${goFuncCoverage[1]}%`;
  }

  // Check threshold
  if (threshold !== null && summary.lineCoverage) {
    const coverageNum = parseFloat(summary.lineCoverage);
    summary.passesThreshold = coverageNum >= threshold;
  }

  return summary;
}

/** Format coverage summary as human-readable text */
function formatCoverageSummary(summary: CoverageSummary): string {
  const lines: string[] = [];
  const statusIcon = summary.passesThreshold ? '[通过]' : '[失败]';

  lines.push(`${statusIcon} 覆盖率报告（${summary.framework}）`);
  lines.push('');

  if (summary.lineCoverage) {
    lines.push(`行覆盖率: ${summary.lineCoverage}`);
  }

  if (summary.totalStatements !== null) {
    lines.push(`语句: ${summary.coveredStatements}/${summary.totalStatements}`);
  }
  if (summary.totalBranches !== null) {
    lines.push(`分支: ${summary.coveredBranches}/${summary.totalBranches}`);
  }
  if (summary.totalFunctions !== null) {
    lines.push(`函数: ${summary.coveredFunctions}/${summary.totalFunctions}`);
  }
  if (summary.totalLines !== null) {
    lines.push(`行: ${summary.coveredLines}/${summary.totalLines}`);
  }

  if (summary.threshold !== null) {
    lines.push('');
    if (summary.passesThreshold) {
      lines.push(`阈值: ${summary.threshold}% - 通过`);
    } else {
      lines.push(`阈值: ${summary.threshold}% - 未通过（当前: ${summary.lineCoverage || '未知'}）`);
    }
  }

  return lines.join('\n');
}

const MAX_OUTPUT = 80_000; // 80KB (coverage output can be verbose)

export const coverageTool: Tool = {
  name: 'coverage',
  description: '运行测试并生成覆盖率报告。自动检测项目的测试框架和覆盖率工具。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['run', 'report'],
        description: 'run: 运行测试并生成覆盖率, report: 查看现有覆盖率报告',
      },
      pattern: {
        type: 'string',
        description: '测试文件过滤模式',
      },
      threshold: {
        type: 'number',
        description: '覆盖率阈值 (0-100)，低于此值报告为失败',
      },
    },
    required: ['action'],
  },
  requiresApproval: true,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action);
    const pattern = args.pattern ? String(args.pattern) : undefined;
    const threshold = args.threshold !== undefined ? Number(args.threshold) : null;
    const isWindows = os.platform() === 'win32';

    // For 'report' action, look for existing coverage reports
    if (action === 'report') {
      const hasFile = (f: string) => fs.existsSync(path.join(ctx.cwd, f));
      const reports: string[] = [];

      // Check for common coverage output locations
      const coverageDirs = ['coverage', 'htmlcov', '.coverage'];
      for (const dir of coverageDirs) {
        if (hasFile(dir)) {
          reports.push(`找到: ${dir}/`);
        }
      }

      // Check for coverage output files
      const coverageFiles = ['coverage.out', 'coverage.lcov', 'lcov.info', '.coverage'];
      for (const file of coverageFiles) {
        if (hasFile(file)) {
          reports.push(`找到: ${file}`);
        }
      }

      if (reports.length === 0) {
        return '未找到已有的覆盖率报告。请先执行 action=run 运行覆盖率。';
      }

      // Try to read coverage summary from text files
      let summaryText = '';

      // Go coverage.out
      if (hasFile('coverage.out')) {
        try {
          const content = fs.readFileSync(path.join(ctx.cwd, 'coverage.out'), 'utf-8');
          const lines = content.split('\n').filter(l => l.trim()).length;
          summaryText += `\ncoverage.out: ${lines} entries`;
        } catch { /* ignore */ }
      }

      return `已有的覆盖率报告:\n${reports.join('\n')}${summaryText}\n\n查看 HTML 报告，请在浏览器中打开 coverage/index.html 或 htmlcov/index.html。`;
    }

    // 'run' action: detect framework and run coverage
    const detection = detectCoverageTool(ctx.cwd);
    if (!detection) {
      return '未检测到支持覆盖率的测试框架。支持: vitest, jest, pytest, go test, cargo tarpaulin。';
    }

    let command = detection.coverageCommand;

    // Add pattern filter if provided
    if (pattern) {
      if (detection.framework === 'jest') {
        command += ` --testPathPattern="${pattern}"`;
      } else if (detection.framework === 'vitest') {
        command += ` ${pattern}`;
      } else if (detection.framework === 'pytest') {
        command += ` -k "${pattern}"`;
      }
    }

    const timeout = 180_000; // 3 minutes for coverage runs

    return new Promise<string>((resolve, reject) => {
      const shell = isWindows ? 'powershell' : 'bash';
      const shellArgs = isWindows
        ? ['-NoProfile', '-NonInteractive', '-Command', `try { ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { Write-Error $_; exit 1 }`]
        : ['-c', command];

      const proc = spawn(shell, shellArgs, {
        cwd: ctx.cwd,
        env: { ...process.env, CI: 'true' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT) + '\n... (output truncated at 80KB)';
          proc.kill();
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT) {
          stderr = stderr.slice(0, MAX_OUTPUT) + '\n... (stderr truncated at 80KB)';
          proc.kill();
        }
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Coverage command timed out after ${timeout}ms`));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);

        const summary = parseCoverageOutput(stdout, stderr, detection.framework, threshold);
        const formatted = formatCoverageSummary(summary);

        const parts = [formatted];

        // Include relevant output (coverage table lines)
        const coverageLines = extractCoverageLines(stdout, stderr, detection.framework);
        if (coverageLines) {
          parts.push('');
          parts.push('--- 覆盖率详情 ---');
          parts.push(coverageLines);
        }

        // If failed, include some error output
        if (code !== 0 && stderr.trim()) {
          parts.push('');
          parts.push('--- 错误输出（前 2KB）---');
          parts.push(stderr.trimEnd().slice(0, 2_000));
        }

        resolve(parts.join('\n'));
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to run coverage command: ${err.message}`));
      });
    });
  },
};

/** Extract the coverage table/detail lines from output */
function extractCoverageLines(stdout: string, stderr: string, framework: string): string {
  const combined = stdout + '\n' + stderr;
  const lines = combined.split('\n');

  // Find coverage table: look for lines with percentage symbols or table borders
  const coverageStart = lines.findIndex(l =>
    l.includes('%') && (l.includes('|') || l.includes('Stmts') || l.includes('Lines') || l.includes('Coverage'))
  );

  if (coverageStart >= 0) {
    // Grab surrounding lines (table)
    let start = coverageStart;
    let end = coverageStart;

    // Expand backwards to include table header
    while (start > 0 && lines[start - 1].trim() && !lines[start - 1].startsWith('---')) {
      start--;
    }

    // Expand forwards until empty line or end of table
    while (end < lines.length - 1 && lines[end + 1].trim() && end - start < 50) {
      end++;
    }

    return lines.slice(start, end + 1).join('\n');
  }

  // For pytest: look for "TOTAL" line and file-level coverage
  if (framework === 'pytest') {
    const totalIdx = lines.findIndex(l => l.startsWith('TOTAL'));
    if (totalIdx >= 0) {
      // Find header (usually a few lines before TOTAL with dashes)
      let start = totalIdx;
      for (let i = totalIdx - 1; i >= Math.max(0, totalIdx - 20); i--) {
        if (lines[i].includes('---') || lines[i].includes('Name')) {
          start = i;
          break;
        }
      }
      return lines.slice(start, totalIdx + 1).join('\n');
    }
  }

  // For Go: look for coverage percentages
  if (framework === 'go') {
    const totalLine = lines.find(l => l.includes('total:') && l.includes('%'));
    if (totalLine) return totalLine;
  }

  return '';
}
