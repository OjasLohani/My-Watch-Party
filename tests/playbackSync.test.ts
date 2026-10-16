// Unit tests for the playback sync math. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedPosition,
  decideCorrection,
  pickClockOffset,
  isNewerSnapshot,
  compensatePublishPosition,
  MAX_PUBLISH_LEAD_MS,
  DRIFT_IGNORE_MS,
  DRIFT_SEEK_MS,
  PAUSED_SEEK_MS,
  MAX_RATE_ADJUST,
} from '../src/lib/playbackService.ts';
import type { PlaybackSnapshot } from '../src/lib/playbackState.ts';

const snap = (over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  movieId: 'movie-1',
  isPlaying: true,
  position: 10,
  rate: 1,
  updatedAtMs: 1_000_000,
  version: 1,
  updatedBy: 'host',
  ...over,
});

test('expectedPosition advances while playing', () => {
  assert.equal(expectedPosition(snap(), 1_000_000 + 2_500), 12.5);
});

test('expectedPosition stays put while paused', () => {
  assert.equal(expectedPosition(snap({ isPlaying: false }), 1_000_000 + 60_000), 10);
});

test('expectedPosition respects rate, duration and never goes negative', () => {
  assert.equal(expectedPosition(snap({ rate: 2 }), 1_000_000 + 1_000), 12);
  assert.equal(expectedPosition(snap(), 1_000_000 + 600_000, 300), 300, 'clamped to duration');
  assert.equal(expectedPosition(snap({ position: 0 }), 1_000_000 - 5_000), 0, 'server time before snapshot');
  assert.equal(expectedPosition(snap(), 1_000_000 + 1_000, Number.NaN), 11, 'unknown duration ignored');
});

test('late joiner lands on the shared timeline', () => {
  // Host pressed play at 30 s; a viewer joins 95 s later with a clock 4 s behind.
  const s = snap({ position: 30, updatedAtMs: 5_000_000 });
  const localNow = 5_095_000 - 4_000;
  const offset = 4_000;
  assert.equal(expectedPosition(s, localNow + offset), 125);
});

test('decideCorrection: ignore jitter, nudge small drift, seek large drift', () => {
  assert.deepEqual(decideCorrection(DRIFT_IGNORE_MS, true), { kind: 'none' });
  assert.deepEqual(decideCorrection(-DRIFT_SEEK_MS, true), { kind: 'seek' });
  assert.deepEqual(decideCorrection(5_000, true), { kind: 'seek' });

  const behind = decideCorrection(-300, true);
  assert.equal(behind.kind, 'rate');
  assert.ok(behind.kind === 'rate' && behind.rate > 1, 'behind → speed up');

  const ahead = decideCorrection(300, true);
  assert.ok(ahead.kind === 'rate' && ahead.rate < 1, 'ahead → slow down');
});

test('decideCorrection: speed change is bounded', () => {
  for (const drift of [-700, -400, 150, 400, 700]) {
    const d = decideCorrection(drift, true);
    assert.equal(d.kind, 'rate');
    if (d.kind === 'rate') assert.ok(Math.abs(d.rate - 1) <= MAX_RATE_ADJUST + 1e-9, `drift ${drift}`);
  }
});

test('decideCorrection: paused viewers only seek when clearly off', () => {
  assert.deepEqual(decideCorrection(PAUSED_SEEK_MS - 1, false), { kind: 'none' });
  assert.deepEqual(decideCorrection(-(PAUSED_SEEK_MS + 1), false), { kind: 'seek' });
});

test('rate correction converges below the 500 ms target', () => {
  // Simulate a viewer 700 ms behind, corrected once per second.
  let drift = -700;
  for (let second = 0; second < 10; second++) {
    const d = decideCorrection(drift, true);
    if (d.kind === 'seek') drift = 0;
    else if (d.kind === 'rate') drift += (d.rate - 1) * 1000;
  }
  assert.ok(Math.abs(drift) <= DRIFT_IGNORE_MS, `final drift ${drift} ms`);
});

test('pickClockOffset uses the fastest round trip', () => {
  const result = pickClockOffset([
    { sentAt: 0, serverMs: 5_400, receivedAt: 800 }, // slow, offset 5000
    { sentAt: 1_000, serverMs: 6_020, receivedAt: 1_040 }, // fast, offset 5000
    { sentAt: 2_000, serverMs: 7_300, receivedAt: 2_300 },
  ]);
  assert.deepEqual(result, { offsetMs: 5_000, rttMs: 40 });
});

test('pickClockOffset ignores broken samples', () => {
  assert.equal(pickClockOffset([]), null);
  assert.equal(pickClockOffset([{ sentAt: 10, serverMs: 5, receivedAt: 5 }]), null, 'negative round trip');
  assert.equal(pickClockOffset([{ sentAt: 0, serverMs: Number.NaN, receivedAt: 10 }]), null);
});

test('host publish is moved forward by the one-way delay only while playing', () => {
  assert.equal(compensatePublishPosition(10, true, 120), 10.12);
  assert.equal(compensatePublishPosition(10, false, 120), 10, 'paused: no compensation');
  assert.equal(compensatePublishPosition(10, true, 0), 10);
  assert.equal(compensatePublishPosition(10, true, Number.NaN), 10);
  assert.equal(compensatePublishPosition(10, true, 99999), 10 + MAX_PUBLISH_LEAD_MS / 1000, 'outliers are capped');
});

test('compensated publish puts viewers level with the host', () => {
  // Host at 30 s clicks play; the change reaches the server 150 ms later.
  const oneWay = 150;
  const clickAt = 1_000_000;
  const snapshot = {
    movieId: 'm', isPlaying: true, rate: 1, version: 1, updatedBy: 'h',
    position: compensatePublishPosition(30, true, oneWay),
    updatedAtMs: clickAt + oneWay,
  };
  const later = clickAt + 5_000;
  const hostPosition = 30 + 5; // host played 5 s since the click
  assert.ok(Math.abs(expectedPosition(snapshot, later) - hostPosition) < 1e-9);
});

test('isNewerSnapshot: version wins, duplicates are ignored', () => {
  const v1 = snap({ version: 1 });
  assert.equal(isNewerSnapshot(null, v1), true);
  assert.equal(isNewerSnapshot(v1, snap({ version: 2 })), true);
  assert.equal(isNewerSnapshot(snap({ version: 3 }), snap({ version: 2 })), false, 'stale update after reconnect');
  assert.equal(isNewerSnapshot(v1, snap({ version: 1 })), false, 'same update twice (RPC reply + realtime echo)');
});
