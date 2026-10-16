import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEASE_RENEW_MS,
  LEASE_TTL_MS,
  pickLikelySuccessor,
  shouldAskServer,
  transferDelayRangeMs,
} from '../src/lib/hostLease.ts';

test('client lease lifetime matches the database (wp_lease_ttl)', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261019120000_stage3b_automatic_host_transfer.sql', import.meta.url), 'utf8');
  const seconds = Number(/select interval '(\d+) seconds'/.exec(sql)?.[1]);
  assert.equal(seconds * 1000, LEASE_TTL_MS);
  assert.ok(LEASE_TTL_MS >= 3 * LEASE_RENEW_MS, 'two renewals may be lost without losing the lease');
});

test('transfer happens within the 5–15 s target (plus one request)', () => {
  const rtt = 300;
  const closed = transferDelayRangeMs(rtt, true);
  const crashed = transferDelayRangeMs(rtt, false);
  assert.deepEqual(closed, { min: 12_300, max: 15_300 });
  assert.deepEqual(crashed, { min: 8_300, max: 15_300 });
  assert.ok(crashed.min >= 5_000);
});

test('a page refresh keeps the lease (needs to be back within the lease time)', () => {
  // With the final renewal on unload, a refresh has the full lease time;
  // without it (worst case) at least TTL − one renewal interval.
  assert.ok(LEASE_TTL_MS - LEASE_RENEW_MS >= 8_000);
});

test('likely successor: first online member in join order, never the host', () => {
  const members = [{ id: 'host' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.equal(pickLikelySuccessor(members, 'host', new Set(['host', 'b', 'c'])), 'b');
  assert.equal(pickLikelySuccessor(members, 'host', new Set(['c', 'd'])), 'c', 'skips offline b');
  assert.equal(pickLikelySuccessor(members, 'b', new Set(['host', 'b'])), 'host', 'old host can be next after a transfer');
  assert.equal(pickLikelySuccessor(members, 'host', new Set()), null);
  assert.equal(pickLikelySuccessor(members, 'host', null), 'b', 'presence unknown: join order');
});

test('first in line asks every tick; others back up less often', () => {
  const ticks = (opts: { isLikelySuccessor: boolean; hostOnline: boolean }) =>
    Array.from({ length: 30 }, (_, i) => i).filter((t) => shouldAskServer(t, opts)).length;
  assert.equal(ticks({ isLikelySuccessor: true, hostOnline: true }), 30);
  assert.equal(ticks({ isLikelySuccessor: false, hostOnline: false }), 10);
  assert.equal(ticks({ isLikelySuccessor: false, hostOnline: true }), 3);
});
