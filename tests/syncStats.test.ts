import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, RollingStats } from '../src/lib/syncStats.ts';

test('percentile uses nearest rank', () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 95);
  assert.equal(percentile(sorted, 100), 100);
  assert.equal(percentile([7], 95), 7);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test('RollingStats summarises and keeps only the latest samples', () => {
  const stats = new RollingStats(10);
  assert.equal(stats.summary(), null);
  for (let i = 1; i <= 20; i++) stats.add(i * 10); // keeps 110..200
  stats.add(Number.NaN); // ignored
  assert.deepEqual(stats.summary(), { count: 10, p50: 150, p95: 200, max: 200 });
});
