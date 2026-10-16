// End-to-end test of automatic host transfer.
//
// Each member (host A, guests B and C) is a separate Chrome browser
// context running the app's real lease and transfer hooks. Their server
// calls are executed, as that signed-in user, against a local PostgreSQL
// 17 (PGlite) with every migration applied, so the real SQL functions,
// the real 12 s lease and the real database clock decide the outcome.
// No Supabase project is involved.
//
// Run with: npm run test:browser
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedDb, as, createRoom, joinRoom, USERS } from '../../supabase/tests/helpers.mjs';
import { startDevServer, launchChrome, wait } from './browserEnv.mjs';

let server;
let baseUrl;
let browser;
let db;

// PGlite has one connection: run one user's request at a time
let chain = Promise.resolve();
const exclusive = (fn) => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};
const dbAs = (who, sql, params) => exclusive(() => as(db, who, sql, params));

/** Members whose network is "down": their requests never arrive */
const offline = new Set();
const renewals = [];
const exitRenewals = [];
/** Open pages per room, to simulate Realtime notifications */
const roomPages = new Map();

/** Like the Realtime rooms UPDATE event: tell every connected member */
async function notifyRoom(roomId, hostId) {
  for (const { who, page } of roomPages.get(roomId) ?? []) {
    if (offline.has(who) || page.isClosed()) continue;
    await page.evaluate((h) => window.harnessSetHost?.(h), hostId).catch(() => {});
  }
}

before(async () => {
  // Test endpoint standing in for the keepalive renewal sent on unload:
  // the dev server records it and applies it like Supabase would.
  const exitEndpoint = {
    name: 'lease-exit-endpoint',
    configureServer(viteServer) {
      viteServer.middlewares.use('/__lease-exit', (req, res) => {
        const url = new URL(req.url, 'http://local');
        const userId = url.searchParams.get('user');
        const code = url.searchParams.get('code');
        const who = Object.keys(USERS).find((k) => USERS[k] === userId);
        if (who && !offline.has(who)) {
          exitRenewals.push({ who, code, at: Date.now() });
          void dbAs(who, 'select public.renew_connection_lease($1)', [code]);
        }
        res.statusCode = 204;
        res.end();
      });
    },
  };
  ({ server, baseUrl } = await startDevServer({ plugins: [exitEndpoint] }));
  browser = await launchChrome();
  db = await createMigratedDb();
});

after(async () => {
  await browser?.close();
  await server?.close();
  await db?.close();
});

const hostIdOf = async (roomId) =>
  (await exclusive(() => db.query('select host_id from public.rooms where id = $1', [roomId]))).rows[0].host_id;
const hostFlags = async (roomId) =>
  (await exclusive(() => db.query('select user_id from public.room_members where room_id = $1 and is_host', [roomId]))).rows
    .map((r) => r.user_id);

async function openMember(who, room) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.exposeFunction('dbRenew', async (code) => {
    if (offline.has(who)) throw new Error('offline');
    await dbAs(who, 'select public.renew_connection_lease($1)', [code]);
    renewals.push({ who, room: room.id, at: Date.now() });
  });
  await page.exposeFunction('dbAsk', async (code) => {
    if (offline.has(who)) throw new Error('offline');
    const before = await hostIdOf(room.id);
    const row = (await dbAs(who, 'select * from public.auto_transfer_host($1)', [code])).rows[0];
    if (row.host_id !== before) void notifyRoom(room.id, row.host_id);
    return { room: { id: row.id, hostId: row.host_id } };
  });
  await page.exposeFunction('dbExit', async (code) => {
    if (offline.has(who)) return;
    exitRenewals.push({ who, room: room.id, at: Date.now() });
    await dbAs(who, 'select public.renew_connection_lease($1)', [code]);
  });
  if (!roomPages.has(room.id)) roomPages.set(room.id, []);
  roomPages.get(room.id).push({ who, page });
  const members = [USERS.A, USERS.B, USERS.C].join(',');
  await page.goto(`${baseUrl}tests/browser/lease.html?user=${USERS[who]}&room=${room.id}&code=${room.code}&host=${USERS.A}&members=${members}`);
  return { page, context };
}

/** Host A, guests B and C (joined in that order), all with pages open */
async function startRoom(name) {
  const room = await exclusive(() => createRoom(db, 'A', name));
  await exclusive(() => joinRoom(db, 'B', room.code));
  await exclusive(() => joinRoom(db, 'C', room.code));
  const members = { A: await openMember('A', room), B: await openMember('B', room), C: await openMember('C', room) };
  await wait(5000); // everyone has renewed at least once
  return { room, members };
}

/** Polls until the host changes; returns the elapsed ms (or null) */
async function timeUntilHostChanges(roomId, from, startedAt, limitMs = 30000) {
  while (Date.now() - startedAt < limitMs) {
    if ((await hostIdOf(roomId)) !== from) return Date.now() - startedAt;
    await wait(250);
  }
  return null;
}

async function closeAll(members) {
  for (const m of Object.values(members)) await m.context.close().catch(() => {});
}

const measured = [];

test('host closes the tab → next guest becomes host within the 5–15 s target', async () => {
  const { room, members } = await startRoom('Tab closed');
  const t0 = Date.now();
  await members.A.page.close();
  const delay = await timeUntilHostChanges(room.id, USERS.A, t0);
  measured.push({ scenario: 'tab closed', ms: delay });
  assert.ok(delay !== null, 'hosting was transferred');
  assert.ok(delay >= 8000, `not premature (${delay} ms)`);
  assert.ok(delay <= 16500, `within target plus one request (${delay} ms)`);
  assert.equal(await hostIdOf(room.id), USERS.B, 'first guest in join order');
  assert.deepEqual(await hostFlags(room.id), [USERS.B], 'exactly one host flag');
  await wait(4000);
  const seenByC = await members.C.page.$eval('#state', (el) => el.dataset.host);
  assert.equal(seenByC, USERS.B, 'other guests learn the new host');
  await closeAll(members);
});

test('host loses internet → transfer within the target', async () => {
  const { room, members } = await startRoom('Network lost');
  const t0 = Date.now();
  offline.add('A');
  const delay = await timeUntilHostChanges(room.id, USERS.A, t0);
  measured.push({ scenario: 'network lost', ms: delay });
  assert.ok(delay !== null && delay >= 5000 && delay <= 16500, `delay ${delay} ms`);
  assert.equal(await hostIdOf(room.id), USERS.B);

  // Previous host comes back: normal member, does not regain hosting
  offline.delete('A');
  await exclusive(() => joinRoom(db, 'A', room.code));
  // Back online: the app resyncs and reloads the room (fetchRoom)
  await members.A.page.evaluate((h) => window.harnessSetHost(h), await hostIdOf(room.id));
  await wait(15000);
  assert.equal(await hostIdOf(room.id), USERS.B, 'old host stays a member');
  assert.equal(await members.A.page.$eval('#state', (el) => el.dataset.host), USERS.B, 'old host sees the new host');
  await closeAll(members);
});

test('host refreshes the page → keeps hosting', async () => {
  const { room, members } = await startRoom('Refresh');
  await members.A.page.reload();
  await members.A.page.reload(); // twice, for good measure
  await wait(20000); // longer than the lease
  assert.equal(await hostIdOf(room.id), USERS.A);
  assert.ok(exitRenewals.some((r) => r.who === 'A' && r.code === room.code), 'a final renewal was sent while unloading');
  await closeAll(members);
});

test('host switches to another tab → keeps hosting', async () => {
  const { room, members } = await startRoom('Tab switch');
  const other = await members.A.context.newPage(); // same browser window, new tab in front
  await other.bringToFront();
  const visibility = await members.A.page.evaluate(() => document.visibilityState);
  const before = renewals.filter((r) => r.who === 'A' && r.room === room.id).length;
  await wait(20000);
  const after = renewals.filter((r) => r.who === 'A' && r.room === room.id).length;
  assert.equal(await hostIdOf(room.id), USERS.A);
  assert.ok(after - before >= 4, `background tab (${visibility}) kept renewing: ${after - before} renewals in 20 s`);
  await closeAll(members);
});

test('malicious early takeover: guests asking repeatedly while the host is connected change nothing', async () => {
  const { room, members } = await startRoom('Malicious');
  const attempts = [];
  for (let i = 0; i < 10; i++) {
    attempts.push(members.B.page.evaluate((c) => window.dbAsk(c), room.code));
    attempts.push(members.C.page.evaluate((c) => window.dbAsk(c), room.code));
  }
  const results = await Promise.all(attempts);
  assert.ok(results.every((r) => r.room.hostId === USERS.A));
  assert.equal(await hostIdOf(room.id), USERS.A);
  await closeAll(members);
});

test('several guests ask at the same moment after the host left → exactly one new host', async () => {
  const { room, members } = await startRoom('Simultaneous');
  offline.add('A');
  await wait(13000); // host lease expired
  const results = await Promise.all([
    members.C.page.evaluate((c) => window.dbAsk(c), room.code),
    members.B.page.evaluate((c) => window.dbAsk(c), room.code),
    members.C.page.evaluate((c) => window.dbAsk(c), room.code),
  ]);
  const hosts = new Set(results.map((r) => r.room.hostId));
  assert.deepEqual([...hosts], [USERS.B], 'every caller sees the same single host');
  assert.deepEqual(await hostFlags(room.id), [USERS.B]);
  offline.delete('A');
  await closeAll(members);
});

test('report', () => {
  console.log('\n  automatic transfer delays:', JSON.stringify(measured));
});
