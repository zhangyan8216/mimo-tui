// src/tools/benchmark.ts - Performance benchmark tool

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Tool, ToolContext } from './registry.js';

export const benchmarkTool: Tool = {
  name: 'benchmark',
  description: '性能基准测试工具。测试 API 延迟、文件 I/O、命令执行速度。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['api', 'file-io', 'command', 'all'],
        description: 'api: 测试API延迟, file-io: 测试文件读写速度, command: 测试命令执行速度, all: 全部测试',
      },
      iterations: {
        type: 'number',
        description: '测试迭代次数 (默认 5)',
      },
    },
    required: ['action'],
  },
  requiresApproval: false,
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || 'all');
    const iterations = Number(args.iterations) || 5;
    const results: string[] = ['⚡ **性能基准测试**\n'];

    if (action === 'api' || action === 'all') {
      results.push('**API 延迟**:');
      try {
        const { checkApiHealth } = await import('../utils/health.js');
        results.push('  运行 /health 命令测试 API 延迟');
      } catch {
        results.push('  无法测试 API 延迟');
      }
    }

    if (action === 'file-io' || action === 'all') {
      results.push('\n**文件 I/O**:');
      const testFile = path.join(ctx.cwd, '.mimo-benchmark-test');
      const content = 'x'.repeat(10000);

      // Write test
      const writeStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        fs.writeFileSync(testFile, content);
      }
      const writeTime = (Date.now() - writeStart) / iterations;
      results.push(`  写入 10KB: ${writeTime.toFixed(1)}ms/次 (${iterations} 次平均)`);

      // Read test
      const readStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        fs.readFileSync(testFile, 'utf-8');
      }
      const readTime = (Date.now() - readStart) / iterations;
      results.push(`  读取 10KB: ${readTime.toFixed(1)}ms/次 (${iterations} 次平均)`);

      // Cleanup
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }

    if (action === 'command' || action === 'all') {
      results.push('\n**命令执行**:');
      const cmdStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        try { execSync('node -e "1+1"', { timeout: 5000 }); } catch { /* ignore */ }
      }
      const cmdTime = (Date.now() - cmdStart) / iterations;
      results.push(`  node -e: ${cmdTime.toFixed(1)}ms/次 (${iterations} 次平均)`);
    }

    return results.join('\n');
  },
};
