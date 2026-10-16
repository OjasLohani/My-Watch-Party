# Testing, measurements and failure handling

## Automated tests

| Command | Count | What it covers |
|---|---|---|
| `npm test` | 138 (includes the 6 concurrency tests) | Sync math (expected position, drift decisions, clock offset, delay compensation, statistics); video catalog; **database tests** that run every migration on a local PostgreSQL 17 (PGlite) with a Supabase-like setup: legacy data preserved, RLS, function permissions, host-only rules, Realtime channel isolation, locking against races, queue/poll edge cases, host takeover, rollbacks, and that frontend calls match SQL signatures |
| `npm run test:concurrency` | 6 | Real PostgreSQL 17 with separate connections: lock matrix, renewal vs transfer in both orders, simultaneous transfers, deadlock stress |
| `npm run test:browser` | 10 | Real Chrome, real `VideoPlayer`: host play → seek → keeps playing; pause → seek stays paused; drag seeks once; reload resumes shared state; media-key pause reaches guests; host transfer during playback; reconnection catch-up; **10-person sync measurement**; production build under the Content Security Policy |

Browser tests use an in-page fake server (80 ms delay) instead of
Supabase, and a throwaway Chrome profile. Nothing touches your Supabase
project.

## Concurrency on a real PostgreSQL server

`npm run test:concurrency` starts a real PostgreSQL 17 (embedded-postgres,
UTF-8 like Supabase), applies every migration, and uses **separate
connections**, so locks and waits behave as on Supabase.

Lock matrix measured between the room functions (row: transaction holding
the lock, column: requested by another member):

| held  requested | renew | auto_transfer | claim | transfer | leave |
|---|---|---|---|---|---|
| renew (FOR SHARE) | runs | waits | waits | waits | waits |
| auto_transfer (FOR NO KEY UPDATE) | waits | waits | waits | waits | waits |
| claim | waits | waits | waits | waits | waits |
| transfer | waits | waits | waits | waits | waits |
| leave | waits | waits | waits | waits | waits |

Renewals from different members run side by side; every host change is
serialized with renewals and with each other. Also tested: a transfer
started while the host is renewing waits and then sees the fresh lease
(host keeps hosting); 8 simultaneous transfer requests produce one host;
240 mixed calls on 4 connections produce no deadlocks. Weakening the
renewal lock to FOR KEY SHARE (which is compatible with FOR NO KEY
UPDATE) makes three of these tests fail.

Lock order: every function that changes a room locks the room row first,
then member / lease / playback / poll rows; none locks a child row and
then waits for the room row.

## Automatic host transfer (end-to-end)

`tests/browser/lease-e2e.browser.mjs` runs host and guests as separate
Chrome browser contexts with the app's real lease and transfer hooks;
their requests are executed as each user against a local PostgreSQL 17
with every migration applied (real SQL, real 12 s lease, database clock).
Realtime notifications and the reconnect resync are simulated.

| Scenario | Result |
|---|---|
| Host closes the tab | First guest becomes host after 12.7–13.0 s; exactly one host |
| Host loses internet | Transfer after ~12.9 s; old host rejoins as a normal member |
| Host refreshes (twice) | Keeps hosting; the unload keepalive renewal is received |
| Host switches to another tab | Keeps hosting; lease renewed ≥ 4 times in 20 s |
| Guests ask 20 times while host is connected | No change |
| Several guests ask at the same moment | One new host, seen identically by all |

Expected delay from disconnect to transfer: 12–15 s after a normal tab
close (the page sends a final renewal), 8–15 s after a crash or network
loss, plus one request round trip (`src/lib/hostLease.ts`).

## Synchronization measurements

Targets from the assignment: ≥ 10 users per room, host command delivery
≤ 250 ms p95 on a local network, drift ≤ 500 ms after correction.

### Test conditions

- 1 host + 9 guests, each in an **isolated Chrome browser context** (own
  connections, like separate people), headless Chrome on one Windows PC.
- Video: first ~3 minutes of *Elephants Dream* (H.264), served locally,
  because ten streams from one PC saturate its connection to archive.org
  (ten real viewers each have their own connection).
- Fake server: stamps and versions each host change, delivers it to all
  ten pages after **80 ms**.
- Drift: every 500 ms for 20 s, each guest's position vs the host's,
  projected to the same instant (360 samples).
- Command latency: host click → guest's `<video>` fires `pause` /
  `playing` (18 samples).

### Results (16–17 Oct 2026)

| Metric | Before the delay compensation | After |
|---|---|---|
| Drift p50 | 91–183 ms | **22–46 ms** |
| Drift p95 | 228–419 ms | **34–66 ms** |
| Drift max | 472–1714 ms | 39–369 ms |
| Command latency p95 (incl. 80 ms simulated server) | 322–784 ms | **229–277 ms** |

Before: the server stamps a change when it **arrives**, so every viewer
trailed the host by the one-way delay. After: the host adds the measured
one-way delay (half the round trip) to the position it publishes.

**What these numbers do not include:** the real network path
host → Supabase → viewer. That depends on everyone's connection and the
Supabase region, so it is measured live in the app instead (below).
The 250 ms p95 target therefore still has to be confirmed on your network.

Reliability of the measurement itself: 2 of 8 ten-person runs failed,
both before the compensation change. One measured a drift p95 of 3.3 s.
For the other, the failure detail was not captured. Both happened while
ten video decoders were running on one PC, and the next five runs passed.
Treat the 10-person browser test as a measurement that can occasionally
fail on a busy machine, and simply run it again.

### Measuring on a real network

In a **guest's** tab, open the browser console (F12) after a few host
actions and type:

```js
window.watchPartySync
// { latencyMs: { count, p50, p95, max }, driftMs: { count, p50, p95, max } }
```

- `latencyMs`: server timestamp of each host change → arrival in this
  browser (uses the measured clock offset).
- `driftMs`: this viewer vs the shared timeline, sampled every second
  while playing.

The same numbers appear in the tooltip of the green drift badge on the
video.

## Failure handling

| Situation | What happens |
|---|---|
| Leave Room fails (network / server) | The confirmation dialog shows the error and you stay in the room; trying again is safe (leaving twice is harmless) |
| Slow / dropped requests | Every Supabase request times out after 15 s; reads fall back to the last data, writes show a readable message ("Network problem…") |
| Supabase library fails to download | Retried on the next action |
| Realtime connection drops | supabase-js retries; if not recovered in 15 s, or the server closed the channel (e.g. expired session), the app rebuilds it with back-off (2 s → 30 s) and shows "Reconnecting…" |
| Tab in background | Heartbeats run in a Web Worker; on return / when back online the room reloads everything (at most every 5 s) |
| Missed updates | Every reconnect reloads playback, chat, queue, poll and members; newer playback versions always win, stale ones are ignored |
| Viewer buffering | Drift correction pauses while buffering, then resumes |
| Host buffering | When the host's video resumes, the host re-sends its real position |
| Video source fails | Player switches to the backup copy at the same position; if all fail, "Video unavailable" with Try Again |
| Autoplay blocked | Viewer sees "The host is playing — click to join" |
| Host disconnects (closed tab, crash, lost connection) | Hosting passes automatically to the longest-present connected guest after the host's 12 s lease expires: measured **12.7–13.0 s** (end-to-end test). Refresh and tab switching keep hosting. |
| Host on an older app version disconnects | Presence shows them offline; after 1 minute guests see a banner; after 3 minutes without any host activity (heartbeat, joining, becoming host, playback command, chat), any member can **take over hosting**. A host who just joined or just received the role is protected for 3 minutes |
| Two actions at once | Database row locks: votes vs poll closing, host transfer vs takeover, member limit, chat rate limit |
