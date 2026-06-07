// src/utils/health.ts - API 健康检查

import type { TokenUsage } from '../api/types.js';
import { createProvider } from '../api/providers/index.js';

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  error?: string;
  usage?: TokenUsage;
}

/** 测试 API 连接和延迟 */
export async function checkApiHealth(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const client = createProvider('auto', apiKey, baseUrl, model);
    const result = await client.chat(
      [{ role: 'user', content: 'Reply with only "OK"' }],
      undefined,
      { maxTokens: 10 },
    );

    return {
      ok: true,
      latencyMs: Date.now() - start,
      model,
      usage: result.usage,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
