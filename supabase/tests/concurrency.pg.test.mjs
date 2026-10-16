// Real concurrency tests: a real PostgreSQL 17 server (embedded-postgres)
// with SEPARATE connections, so locks and waits behave exactly as on
// Supabase. Runs every migration (Stage 1 → 3b) first.
//
// Run with: npm run test:concurrency
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { SHIM, legacySchema, STAGE1, STAGE2, STAGE3, STAGE3B, USERS, PROFILE } from './helpers.mjs';

const PORT = 55433;
let server;
let dataDir;
let admin;
const clients = [];

async function connect() {
  const client = new pg.Client({ port: PORT, user: 'postgres', password: 'test', database: 'postgres' });
  await client.connect();
  client.on('notice', () => {});
  clients.push(client);
  return client;
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'watch-party-pg-'));
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test', port: PORT, persistent: false, onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // like Supabase (UTF-8)
  });
  await server.initialise();
  await server.start();
  admin = await connect();
  await admin.query(SHIM);
  await admin.query(`set role owner_role; ${legacySchema(true)} reset role;`);
  for (const id of Object.values(USERS)) await admin.query('insert into auth.users (id) values ($1)', [id]);
  for (const sql of [STAGE1, STAGE2, STAGE3, STAGE3B]) {
    await admin.query('set role owner_role');
    await admin.query(sql);
    await admin.query('reset role');
  }
});

after(async () => {
  for (const c of clients) await c.end().catch(() => {});
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** One statement as a signed-in user, in its own transaction */
async function asUser(client, who, sql, params = []) {
  await client.query(`select set_config('request.jwt.claim.sub', $1, false)`, [USERS[who]]);
  await client.query('set role authenticated');
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('reset role');
  }
}

/** Opens a transaction as `who` and runs `sql` in it WITHOUT committing */
async function beginAs(client, who, sql, params = []) {
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS[who]]);
  await client.query('set local role authenticated');
  return client.query(sql, params);
}

/** True if connection `client` is currently waiting for a lock */
async function isWaitingForLock(client) {
  const { rows } = await admin.query(
    `select wait_event_type from pg_stat_activity where pid = $1`, [client.processID]);
  return rows[0]?.wait_event_type === 'Lock';
}

async function waitUntilBlocked(client, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isWaitingForLock(client)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const hostOf = async (roomId) => (await admin.query('select host_id from public.rooms where id = $1', [roomId])).rows[0].host_id;
const hostFlags = async (roomId) =>
  (await admin.query('select user_id from public.room_members where room_id = $1 and is_host order by user_id', [roomId])).rows.map((r) => r.user_id);
const ageLease = (roomId, who, seconds) =>
  admin.query(`update public.room_connection_leases set renewed_at = now() - make_interval(secs => $3)
               where room_id = $1 and user_id = $2`, [roomId, USERS[who], seconds]);

let roomCounter = 0;
/** Room with host A and guests B, C (in that order), all with live leases */
async function newRoom() {
  const c = await connect();
  const room = (await asUser(c, 'A', 'select * from public.create_room($1, $2, $3, $4, $5, $6)',
    [`Room ${++roomCounter}`, 'movie-1', false, 'A', PROFILE.avatar, PROFILE.color])).rows[0];
  for (const who of ['B', 'C']) {
    await asUser(c, who, 'select public.join_room($1, $2, $3, $4)', [room.code, who, PROFILE.avatar, PROFILE.color]);
  }
  for (const who of ['A', 'B', 'C']) await asUser(c, who, 'select public.renew_connection_lease($1)', [room.code]);
  return room;
}

test('real server: FOR SHARE and FOR NO KEY UPDATE conflict (PostgreSQL lock table)', async () => {
  const room = await newRoom();
  const a = await connect();
  const b = await connect();
  await a.query('begin');
  await a.query('select 1 from public.rooms where id = $1 for share', [room.id]);
  await b.query('begin');
  await assert.rejects(b.query('select 1 from public.rooms where id = $1 for no key update nowait', [room.id]),
    /could not obtain lock/);
  await b.query('rollback');
  await a.query('rollback');
});

test('lock matrix of the five room functions (separate connections)', async () => {
  // Each function as the holder (transaction left open), then each as the
  // requester with a short lock timeout: does the requester have to wait?
  const room = await newRoom();
  // Holders must SUCCEED: a failed statement aborts its transaction and
  // releases its locks at once. Requesters run as other members.
  const holders = {
    renew: ['B', 'select public.renew_connection_lease($1)', (code) => [code]],
    auto_transfer: ['C', 'select public.auto_transfer_host($1)', (code) => [code]], // host connected: no-op
    claim: ['A', 'select public.claim_host($1)', (code) => [code]], // host claiming: no-op
    transfer: ['A', 'select public.transfer_host($1, $2)', (code) => [code, USERS.A]], // to self: no-op
    leave: ['A', 'select public.leave_room($1)', (code) => [code]],
  };
  const requesters = {
    renew: ['C', 'select public.renew_connection_lease($1)', (code) => [code]], // a different member
    auto_transfer: ['B', 'select public.auto_transfer_host($1)', (code) => [code]],
    claim: ['B', 'select public.claim_host($1)', (code) => [code]],
    transfer: ['A', 'select public.transfer_host($1, $2)', (code) => [code, USERS.A]],
    leave: ['B', 'select public.leave_room($1)', (code) => [code]],
  };
  const matrix = {};
  for (const [holder, [hWho, hSql, hArgs]] of Object.entries(holders)) {
    matrix[holder] = {};
    for (const [requester, [rWho, rSql, rArgs]] of Object.entries(requesters)) {
      const h = await connect();
      const r = await connect();
      await beginAs(h, hWho, hSql, hArgs(room.code)); // must succeed (see above)
      await r.query('begin');
      await r.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS[rWho]]);
      await r.query('set local role authenticated');
      await r.query(`set local lock_timeout = '300ms'`);
      let blocked = false;
      try {
        await r.query(rSql, rArgs(room.code));
      } catch (e) {
        blocked = /lock timeout/.test(e.message);
      }
      matrix[holder][requester] = blocked ? 'waits' : 'runs';
      await r.query('rollback');
      await h.query('rollback');
      await h.end();
      await r.end();
      clients.splice(clients.indexOf(h), 1);
      clients.splice(clients.indexOf(r), 1);
    }
  }
  console.log('\n  lock matrix (row: held by, column: requested):\n' +
    Object.entries(matrix).map(([k, v]) => `    ${k.padEnd(14)} ${JSON.stringify(v)}`).join('\n'));

  // Renewals run side by side; everything else is serialized
  assert.equal(matrix.renew.renew, 'runs', 'members renew in parallel');
  for (const f of ['auto_transfer', 'claim', 'transfer', 'leave']) {
    assert.equal(matrix.renew[f], 'waits', `${f} waits for a renewal in progress`);
    assert.equal(matrix[f].renew, 'waits', `a renewal waits for ${f} in progress`);
    for (const g of ['auto_transfer', 'claim', 'transfer', 'leave']) {
      assert.equal(matrix[f][g], 'waits', `${g} waits for ${f}`);
    }
  }
});

test('host renewing while a transfer runs cannot lose hosting to a stale lease read', async () => {
  const room = await newRoom();
  await ageLease(room.id, 'A', 20); // host lease looks expired…
  const host = await connect();
  const guest = await connect();

  // …but the host is renewing right now (transaction open, not committed)
  await beginAs(host, 'A', 'select public.renew_connection_lease($1)', [room.code]);

  // The guest's transfer must WAIT for the renewal, not read the old lease
  const transfer = beginAs(guest, 'B', 'select * from public.auto_transfer_host($1)', [room.code]);
  assert.equal(await waitUntilBlocked(guest), true, 'auto_transfer_host waits for the renewal');

  await host.query('commit');
  const result = (await transfer).rows[0];
  await guest.query('commit');
  assert.equal(result.host_id, USERS.A, 'transfer saw the fresh lease: no change');
  assert.equal(await hostOf(room.id), USERS.A);
  assert.deepEqual(await hostFlags(room.id), [USERS.A]);
});

test('transfer first, renewal second: renewal waits; the decision used the lease as it was', async () => {
  const room = await newRoom();
  await ageLease(room.id, 'A', 20);
  const host = await connect();
  const guest = await connect();

  await beginAs(guest, 'B', 'select * from public.auto_transfer_host($1)', [room.code]); // transfers, not committed
  const renewal = beginAs(host, 'A', 'select public.renew_connection_lease($1)', [room.code]);
  assert.equal(await waitUntilBlocked(host), true, 'renewal waits for the transfer');
  await guest.query('commit');
  await renewal;
  await host.query('commit');
  assert.equal(await hostOf(room.id), USERS.B, 'the lease really had expired when the transfer ran');
  assert.deepEqual(await hostFlags(room.id), [USERS.B]);
});

test('many guests call auto_transfer_host at the same moment → exactly one new host', async () => {
  const room = await newRoom();
  const extra = await connect();
  await asUser(extra, 'D', 'select public.join_room($1, $2, $3, $4)', [room.code, 'D', PROFILE.avatar, PROFILE.color]);
  await asUser(extra, 'D', 'select public.renew_connection_lease($1)', [room.code]);
  await ageLease(room.id, 'A', 20);

  const conns = await Promise.all(Array.from({ length: 8 }, () => connect()));
  const callers = ['B', 'C', 'D', 'B', 'C', 'D', 'C', 'B'];
  const results = await Promise.all(conns.map((c, i) =>
    asUser(c, callers[i], 'select * from public.auto_transfer_host($1)', [room.code])));
  const hosts = new Set(results.map((r) => r.rows[0].host_id));
  assert.deepEqual([...hosts], [USERS.B], 'every caller saw the same single successor');
  assert.deepEqual(await hostFlags(room.id), [USERS.B]);
});

test('stress: mixed concurrent room actions never deadlock and keep one consistent host', async () => {
  const room = await newRoom();
  const extra = await connect();
  await asUser(extra, 'D', 'select public.join_room($1, $2, $3, $4)', [room.code, 'D', PROFILE.avatar, PROFILE.color]);
  const poll = (await asUser(extra, 'A', 'select * from public.create_poll($1, $2, $3)', [room.code, 'Q?', ['a', 'b']])).rows[0];

  const actions = [
    (who) => ['select public.renew_connection_lease($1)', [room.code]],
    (who) => ['select public.auto_transfer_host($1)', [room.code]],
    (who) => ['select public.claim_host($1)', [room.code]],
    (who) => ['select public.transfer_host($1, $2)', [room.code, USERS[who === 'A' ? 'B' : 'A']]],
    (who) => ['select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 10]],
    (who) => ['select public.send_message($1, $2)', [room.code, `hi from ${who}`]],
    (who) => ['select public.vote_poll($1, $2, $3)', [room.code, poll.id, 0]],
    (who) => ['select public.touch_room($1)', [room.code]],
    (who) => ['select public.playlist_add($1, $2)', [room.code, `movie-${Math.floor(Math.random() * 40)}`]],
  ];
  const deadlocks = [];
  const unexpected = [];
  const who = ['A', 'B', 'C', 'D'];
  const workers = await Promise.all(who.map(() => connect()));
  const started = Date.now();
  await Promise.all(workers.map(async (c, w) => {
    for (let i = 0; i < 60; i++) {
      const me = who[(w + i) % who.length];
      const [sql, params] = actions[(w * 7 + i * 3) % actions.length](me);
      try {
        await asUser(c, me, sql, params);
      } catch (e) {
        if (e.code === '40P01') deadlocks.push(e.message);
        // Refusals are expected (not host, already voted, too fast…)
        else if (!/Only the|still connected|already|too quickly|not a member|queue|Too many/.test(e.message)) unexpected.push(e.message);
      }
    }
  }));
  console.log(`\n  stress: 240 calls on 4 connections in ${Date.now() - started} ms`);
  assert.deepEqual(deadlocks, [], 'no deadlocks');
  assert.deepEqual(unexpected, [], 'no unexpected errors');

  const hostId = await hostOf(room.id);
  assert.deepEqual(await hostFlags(room.id), [hostId], 'is_host flags agree with rooms.host_id');
});
