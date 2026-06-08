// src/utils/cost.ts - Cost tracking and summaries.

import fs from 'fs';
import path from 'path';
import { getMimoPath } from './paths.js';

function getCostLog(): string {
  return getMimoPath('cost.json');
}

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

function readRecords(): CostRecord[] {
  const costLog = getCostLog();
  if (!fs.existsSync(costLog)) return [];
  const parsed = JSON.parse(fs.readFileSync(costLog, 'utf-8'));
  return Array.isArray(parsed) ? parsed : [];
}

export function logCost(record: CostRecord): void {
  const costLog = getCostLog();
  try {
    let records = readRecords();
    records.push(record);
    if (records.length > 1000) records = records.slice(-1000);
    fs.mkdirSync(path.dirname(costLog), { recursive: true });
    fs.writeFileSync(costLog, JSON.stringify(records, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

export function getCostSummary(): CostSummary {
  try {
    const records = readRecords();
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
