// Stage 2 security review: Realtime channel isolation alongside existing
// policies, topic format, locking against races, function permissions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE2, STAGE2_ROLLBACK, USERS,
  createDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

/** Can `who` read (join) / write (send) on `topic`, as Realtime checks it? */
async function channelAccess(db, who, topic) {
  const read = (await as(db, who, 'select 1 from realtime.messages', [], { topic })).rows.length > 0;
  const sendError = await errorOf(db, who,
    `insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{}')`, [topic], { topic });
  return { read, send: sendError === null, sendError };
}

async function seedTopic(db, topic) {
  await db.query(`insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{}')`, [topic]);
}

test('room channels stay members-only even with a broad existing Realtime policy', async (t) => {
  const db = await createDb({ broadRealtimePolicies: true });
  assert.ok((await migrate(db, STAGE1)).ok);
  const result = await migrate(db, STAGE2);
  assert.ok(result.ok, result.error);

  await t.test('existing policies are reported and kept', async () => {
    assert.ok(result.notices.some((n) => n.includes('Existing realtime.messages policy kept: Existing broad read')));
    const { rows } = await db.query(`select policyname from pg_policies where schemaname = 'realtime' order by 1`);
    const names = rows.map((r) => r.policyname);
    assert.ok(names.includes('Existing broad read') && names.includes('Existing broad write'));
  });

  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);
  const topic = `room:${room.id}`;
  await seedTopic(db, topic);
  await seedTopic(db, 'lobby');

  await t.test('members can join and send', async () => {
    assert.deepEqual(await channelAccess(db, 'A', topic), { read: true, send: true, sendError: null });
    assert.deepEqual(await channelAccess(db, 'B', topic), { read: true, send: true, sendError: null });
  });

  await t.test('non-members and anon are blocked despite the broad policy', async () => {
    for (const who of ['C', 'D', null]) {
      const access = await channelAccess(db, who, topic);
      assert.equal(access.read, false, `${who ?? 'anon'} must not read`);
      assert.equal(access.send, false, `${who ?? 'anon'} must not send`);
      assert.match(access.sendError, /row-level security/, 'denied by policy, not by an unrelated error');
    }
  });

  await t.test('unrelated channels keep working under the existing policy', async () => {
    assert.deepEqual(await channelAccess(db, 'C', 'lobby'), { read: true, send: true, sendError: null });
    assert.deepEqual(await channelAccess(db, null, 'lobby'), { read: true, send: true, sendError: null });
  });

  await t.test('malformed room topics are rejected even for members', async () => {
    const bad = [
      `${topic}:extra`,
      `${topic} `,
      `room:${room.id.toUpperCase()}`,
      `ROOM:${room.id}`,
      `room:`,
      `room:${room.id.slice(0, -1)}`,
      `room:not-a-uuid`,
    ];
    for (const badTopic of bad) {
      await seedTopic(db, badTopic);
      const access = await channelAccess(db, 'A', badTopic);
      assert.equal(access.read, false, `read ${JSON.stringify(badTopic)}`);
      assert.equal(access.send, false, `send ${JSON.stringify(badTopic)}`);
    }
  });

  await t.test("members cannot reach another room's channel", async () => {
    const other = await createRoom(db, 'C', 'Other');
    const otherTopic = `room:${other.id}`;
    await seedTopic(db, otherTopic);
    assert.deepEqual((await channelAccess(db, 'B', otherTopic)).read, false);
    assert.deepEqual((await channelAccess(db, 'B', otherTopic)).send, false);
  });

  await t.test('only broadcast / presence can be sent on room channels', async () => {
    const err = await errorOf(db, 'A',
      `insert into realtime.messages (topic, extension, payload) values ($1, 'postgres_changes', '{}')`, [topic], { topic });
    assert.match(err, /row-level security/);
  });

  await t.test('rollback removes only Watch Party policies', async () => {
    await db.query('set role owner_role');
    await db.exec(STAGE2_ROLLBACK);
    await db.query('reset role');
    const { rows } = await db.query(`select policyname from pg_policies where schemaname = 'realtime' order by 1`);
    assert.deepEqual(rows.map((r) => r.policyname), ['Existing broad read', 'Existing broad write']);
    assert.ok((await migrate(db, STAGE2)).ok, 're-applies after rollback');
  });

  await db.close();
});

test('pre-flight refuses when RLS is off on realtime.messages', async () => {
  const db = await createDb({ realtimeRls: false });
  assert.ok((await migrate(db, STAGE1)).ok);
  const before = await legacySnapshot(db);
  const result = await migrate(db, STAGE2);
  assert.equal(result.ok, false);
  assert.match(result.error, /Row Level Security is disabled on realtime.messages/);
  assert.equal((await db.query(`select to_regclass('public.room_messages') as t`)).rows[0].t, null, 'nothing created');
  assert.equal(await legacySnapshot(db), before);
  await db.close();
});

test('races are prevented with row and advisory locks', async (t) => {
  const db = await createDb();
  assert.ok((await migrate(db, STAGE1)).ok);
  assert.ok((await migrate(db, STAGE2)).ok);
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);

  // PGlite has a single connection, so two transactions cannot run at
  // once here. Instead we check, inside one open transaction, that the
  // lock which makes concurrent callers wait is actually held.
  async function inTransactionAs(who, sql, params, inspect) {
    await db.exec('begin');
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS[who]]);
      await db.query('set local role authenticated');
      await db.query(sql, params);
      await db.query('reset role');
      return await inspect();
    } finally {
      await db.exec('rollback');
    }
  }

  await t.test('send_message holds a per-user advisory lock until commit', async () => {
    const locks = await inTransactionAs('B', 'select public.send_message($1, $2)', [room.code, 'hi'], async () =>
      (await db.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and granted`)).rows[0].n);
    assert.equal(locks, 1);
  });

  await t.test('vote_poll takes a FOR SHARE lock on the poll row', async () => {
    // The vote's foreign key alone only takes FOR KEY SHARE, which does
    // NOT block close_poll's UPDATE. FOR SHARE does, so the check of
    // is_active and the insert happen before any concurrent close.
    // (Lock strength cannot be observed on a single connection, so this
    // guards the function definition itself.)
    const { rows } = await db.query(
      `select pg_get_functiondef('public.vote_poll(text,bigint,integer)'::regprocedure) as def`);
    assert.match(rows[0].def, /and p\.is_active\s+for share;/);
  });

  await t.test('votes after closing are refused; a vote is counted once', async () => {
    const poll = (await as(db, 'A', 'select * from public.create_poll($1, $2, $3)', [room.code, 'Again?', ['x', 'y']])).rows[0];
    await as(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 1]);
    await as(db, 'A', 'select public.close_poll($1, $2)', [room.code, poll.id]);
    assert.match(await errorOf(db, 'A', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 0]), /closed/);
    const n = (await db.query('select count(*)::int as n from public.room_poll_votes where poll_id = $1', [poll.id])).rows[0].n;
    assert.equal(n, 1);
  });

  await db.close();
});

test('function permissions: browsers can call only the public RPCs', async () => {
  const db = await createDb();
  assert.ok((await migrate(db, STAGE1)).ok);
  assert.ok((await migrate(db, STAGE2)).ok);

  const publicRpcs = [
    'server_time()', 'set_playback(text,text,boolean,double precision)', 'send_message(text,text)',
    'playlist_add(text,text)', 'playlist_remove(text,bigint)', 'playlist_move(text,bigint,integer)',
    'create_poll(text,text,text[])', 'close_poll(text,bigint)', 'vote_poll(text,bigint,integer)',
  ];
  const can = async (role, fn) =>
    (await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, `public.${fn}`])).rows[0].ok;

  for (const fn of publicRpcs) {
    assert.equal(await can('authenticated', fn), true, `authenticated → ${fn}`);
    assert.equal(await can('anon', fn), false, `anon → ${fn}`);
  }
  assert.equal(await can('authenticated', 'wp_member_room(text,boolean)'), false, 'internal helper');
  assert.equal(await can('anon', 'wp_member_room(text,boolean)'), false, 'internal helper');

  // Every SECURITY DEFINER function pins its search_path.
  const { rows } = await db.query(`
    select p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""')
  `);
  assert.deepEqual(rows, [], 'SECURITY DEFINER without a pinned search_path');

  // Stage 1 room creation and joining still work after Stage 2.
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);
  assert.equal((await as(db, 'B', 'select count(*)::int as n from public.room_members')).rows[0].n, 2);
  await db.close();
});
