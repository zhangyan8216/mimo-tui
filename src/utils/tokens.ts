// src/utils/tokens.ts - Token counting & usage tracking

import type { TokenUsage } from '../api/types.js';

export function createEmptyUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  };
}

export function accumulateUsage(total: TokenUsage, addition: TokenUsage): TokenUsage {
  return {
    promptTokens: total.promptTokens + addition.promptTokens,
    completionTokens: total.completionTokens + addition.completionTokens,
    totalTokens: total.totalTokens + addition.totalTokens,
    cacheHitTokens: total.cacheHitTokens + addition.cacheHitTokens,
    cacheMissTokens: total.cacheMissTokens + addition.cacheMissTokens,
  };
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

export function formatCost(usage: TokenUsage): string {
  // MiMo v2.5 Pro pricing (approximate)
  const inputCostPer1M = 0.435;   // $0.435/1M tokens (cache miss)
  const cacheHitCostPer1M = 0.003625; // $0.003625/1M tokens (cache hit)
  const outputCostPer1M = 0.87;   // $0.87/1M tokens

  const inputCost = (usage.cacheMissTokens / 1_000_000) * inputCostPer1M +
                    (usage.cacheHitTokens / 1_000_000) * cacheHitCostPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * outputCostPer1M;
  const total = inputCost + outputCost;

  return `$${total.toFixed(4)}`;
}

export function formatCacheRate(usage: TokenUsage): string {
  const total = usage.cacheHitTokens + usage.cacheMissTokens;
  if (total === 0) return '0%';
  return `${Math.round((usage.cacheHitTokens / total) * 100)}%`;
}
