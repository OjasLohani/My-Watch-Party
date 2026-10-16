// Rolling statistics for synchronization quality, measured in each
// viewer's browser:
//  - latency: time from the host's change (server timestamp) until this
//    viewer received it, using the measured server clock offset
//  - drift:   distance between this viewer's video and the shared timeline
// Inspect in the browser console with: window.watchPartySync

export interface StatsSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

/** Nearest-rank percentile of an ascending array (p in 0–100) */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export class RollingStats {
  private readonly samples: number[] = [];
  private readonly limit: number;

  constructor(limit = 300) {
    this.limit = limit;
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    this.samples.push(value);
    if (this.samples.length > this.limit) this.samples.shift();
  }

  summary(): StatsSummary | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      max: Math.round(sorted[sorted.length - 1]),
    };
  }
}
