// src/utils/monitor.ts - Performance monitoring

import { log } from './logger.js';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export class Monitor {
  private metrics: PerformanceMetric[] = [];
  private timers: Map<string, number> = new Map();
  private maxMetrics = 1000;

  /** Start a named timer */
  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }

  /** Stop a timer and record the metric */
  endTimer(name: string): number {
    const start = this.timers.get(name);
    if (!start) return 0;
    const duration = Date.now() - start;
    this.timers.delete(name);
    this.record(name, duration, 'ms');
    return duration;
  }

  /** Record a metric */
  record(name: string, value: number, unit: string): void {
    this.metrics.push({ name, value, unit, timestamp: Date.now() });
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics / 2);
    }
  }

  /** Get metrics summary */
  getSummary(): Record<string, { count: number; avg: number; min: number; max: number; unit: string }> {
    const groups: Record<string, { values: number[]; unit: string }> = {};
    for (const m of this.metrics) {
      if (!groups[m.name]) groups[m.name] = { values: [], unit: m.unit };
      groups[m.name].values.push(m.value);
    }
    const summary: Record<string, { count: number; avg: number; min: number; max: number; unit: string }> = {};
    for (const [name, g] of Object.entries(groups)) {
      if (g.values.length === 0) continue;
      const sum = g.values.reduce((a, b) => a + b, 0);
      summary[name] = {
        count: g.values.length,
        avg: Math.round(sum / g.values.length),
        min: g.values.reduce((a, b) => Math.min(a, b), Infinity),
        max: g.values.reduce((a, b) => Math.max(a, b), -Infinity),
        unit: g.unit,
      };
    }
    return summary;
  }

  /** Get formatted report */
  getReport(): string {
    const summary = this.getSummary();
    const lines: string[] = ['\u{1F4CA} **性能监控**\n'];
    for (const [name, s] of Object.entries(summary)) {
      lines.push(`${name}: avg ${s.avg}${s.unit} (min ${s.min}, max ${s.max}, ${s.count} samples)`);
    }
    if (lines.length === 1) lines.push('暂无性能数据');
    return lines.join('\n');
  }

  /** Get recent metrics for a specific name */
  getRecent(name: string, count = 10): PerformanceMetric[] {
    return this.metrics.filter(m => m.name === name).slice(-count);
  }

  clear(): void {
    this.metrics = [];
    this.timers.clear();
  }
}

// Global monitor instance
export const monitor = new Monitor();
