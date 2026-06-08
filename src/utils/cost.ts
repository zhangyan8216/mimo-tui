// src/utils/cost.ts - 成本追踪和告警

import os from 'os';
import fs from 'fs';
import path from 'path';

const COST_LOG = path.join(os.homedir(), '.mimo', 'cost.json');

export interface CostRecord {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  costUsd: number;
  sessionId: string;
}

export interface CostSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  total: number;
  recordCount: number;
}

// MiMo v2.5 Pro 定价 (每百万 token)
const PRICING: Record<string, { input: number; output: number; cacheHit: number }> = {
  'mimo-v2.5-pro': { input: 0.435, output: 0.87, cacheHit: 0.003625 },
  'mimo-v2.5-flash': { input: 0.14, output: 0.28, cacheHit: 0.0028 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheHitTokens: number,
): number {
  const pricing = PRICING[model] || PRICING['mimo-v2.5-pro'];
  const cacheMissTokens = Math.max(0, inputTokens - cacheHitTokens);
  const inputCost = (cacheMissTokens / 1_000_000) * pricing.input;
  const cacheCost = (cacheHitTokens / 1_000_000) * pricing.cacheHit;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + cacheCost + outputCost;
}

export function logCost(record: CostRecord): void {
  try {
    let records: CostRecord[] = [];
    if (fs.existsSync(COST_LOG)) {
      const parsed = JSON.parse(fs.readFileSync(COST_LOG, 'utf-8'));
      records = Array.isArray(parsed) ? parsed : [];
    }
    records.push(record);
    // 只保留最近 1000 条
    if (records.length > 1000) records = records.slice(-1000);
    fs.mkdirSync(path.dirname(COST_LOG), { recursive: true });
    fs.writeFileSync(COST_LOG, JSON.stringify(records, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

export function getCostSummary(): CostSummary {
  try {
    if (!fs.existsSync(COST_LOG)) return { today: 0, thisWeek: 0, thisMonth: 0, total: 0, recordCount: 0 };

    const records: CostRecord[] = JSON.parse(fs.readFileSync(COST_LOG, 'utf-8'));
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7);

    let todayCost = 0, weekCost = 0, monthCost = 0, totalCost = 0;
    for (const r of records) {
      totalCost += r.costUsd;
      if (r.date >= today) todayCost += r.costUsd;
      if (r.date >= weekAgo) weekCost += r.costUsd;
      if (r.date >= monthStart) monthCost += r.costUsd;
    }

    return { today: todayCost, thisWeek: weekCost, thisMonth: monthCost, total: totalCost, recordCount: records.length };
  } catch {
    return { today: 0, thisWeek: 0, thisMonth: 0, total: 0, recordCount: 0 };
  }
}
