// src/utils/__tests__/tokens.test.ts
import { describe, it, expect } from 'vitest';
import {
  createEmptyUsage,
  accumulateUsage,
  formatTokenCount,
  formatCost,
  formatCacheRate,
} from '../tokens.js';
import type { TokenUsage } from '../../api/types.js';

describe('createEmptyUsage', () => {
  it('returns all zero fields', () => {
    const usage = createEmptyUsage();
    expect(usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
    });
  });
});

describe('accumulateUsage', () => {
  it('adds two usage objects correctly', () => {
    const total: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheHitTokens: 30,
      cacheMissTokens: 70,
    };
    const addition: TokenUsage = {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
      cacheHitTokens: 60,
      cacheMissTokens: 140,
    };
    const result = accumulateUsage(total, addition);
    expect(result).toEqual({
      promptTokens: 300,
      completionTokens: 150,
      totalTokens: 450,
      cacheHitTokens: 90,
      cacheMissTokens: 210,
    });
  });

  it('works with empty usage', () => {
    const empty = createEmptyUsage();
    const addition: TokenUsage = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheHitTokens: 2,
      cacheMissTokens: 8,
    };
    const result = accumulateUsage(empty, addition);
    expect(result).toEqual(addition);
  });
});

describe('formatTokenCount', () => {
  it('formats small numbers as-is', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('formats thousands with k suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0k');
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(12345)).toBe('12.3k');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
  });
});

describe('formatCost', () => {
  it('returns $0.0000 for zero usage', () => {
    expect(formatCost(createEmptyUsage())).toBe('$0.0000');
  });

  it('calculates cost correctly', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
      cacheHitTokens: 500_000,
      cacheMissTokens: 500_000,
    };
    // input: 500k miss * $0.435/1M + 500k hit * $0.003625/1M = $0.2175 + $0.0018125
    // output: 1M * $0.87/1M = $0.87
    // total: $0.2175 + $0.0018125 + $0.87 = $1.0893125
    const result = formatCost(usage);
    expect(result).toBe('$1.0893');
  });
});

describe('formatCacheRate', () => {
  it('returns 0% for zero tokens', () => {
    expect(formatCacheRate(createEmptyUsage())).toBe('0%');
  });

  it('returns 100% when all are cache hits', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheHitTokens: 100,
      cacheMissTokens: 0,
    };
    expect(formatCacheRate(usage)).toBe('100%');
  });

  it('returns 0% when no cache hits', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheHitTokens: 0,
      cacheMissTokens: 100,
    };
    expect(formatCacheRate(usage)).toBe('0%');
  });

  it('rounds to nearest integer', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheHitTokens: 33,
      cacheMissTokens: 67,
    };
    // 33/100 = 33%
    expect(formatCacheRate(usage)).toBe('33%');
  });
});
