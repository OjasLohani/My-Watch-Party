// Stage 3b: automatic host transfer with server-side connection leases.
//
// Time is simulated by moving lease timestamps into the past; the
// functions themselves only ever use the database clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE2, STAGE3, STAGE3B, STAGE3B_ROLLBACK, USERS, PROFILE,
  createDb, createMigratedDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

const hostOf = async (db, roomId) =>
  (await db.query('select host_id from public.rooms where id = $1', [roomId])).rows[0].host_id;

const renew = (db, who, code) => as(db, who, 'select public.renew_connection_lease($1)', [code]);
const autoTransfer = async (db, who, code) =>
  (await as(db, who, 'select * from public.auto_transfer_host($1)', [code])).rows[0];

/** Moves a member's last lease renewal `seconds` into the past */
const ageLease = (db, roomId, userId, seconds) =>
  db.query(`update public.room_connection_leases set renewed_at = now() - make_interval(secs => $3)
            where room_id = $1 and user_id = $2`, [roomId, userId, seconds]);

const hostFlags = async (db, roomId) =>
  (await db.query('select user_id from public.room_members where room_id = $1 and is_host', [roomId])).rows.map((r) => r.user_id);

/** Room with host A and guests B, C (joined in that order), all connected */
async function connectedRoom(db, name) {
  const room = await createRoom(db, 'A', name);
  await joinRoom(db, 'B', room.code);
  await joinRoom(db, 'C', room.code);
  for (const who of ['A', 'B', 'C']) await renew(db, who, room.code);
  return room;
}

test('migration: order, re-runs, private lease table', async (t) => {
  const db = await createDb();
  const before = await legacySnapshot(db);

  await t.test('needs Stage 3 first; applies and re-runs', async () => {
    assert.ok((await migrate(db, STAGE1)).ok);
    assert.ok((await migrate(db, STAGE2)).ok);
    const early = await migrate(db, STAGE3B);
    assert.equal(early.ok, false);
    assert.match(early.error, /Stage 1, 2 and 3/);
    assert.ok((await migrate(db, STAGE3)).ok);
    assert.ok((await migrate(db, STAGE3B)).ok);
    assert.ok((await migrate(db, STAGE3B)).ok, 're-run');
    assert.equal(await legacySnapshot(db), before);
  });

  await t.test('browsers cannot read or write leases, or set host directly', async () => {
    const room = await createRoom(db, 'A');
    await renew(db, 'A', room.code);
    assert.match(await errorOf(db, 'A', 'select * from public.room_connection_leases'), /permission denied/);
    assert.match(await errorOf(db, 'A', `update public.room_connection_leases set renewed_at = now() + interval '1 day'`), /permission denied/);
    assert.match(await errorOf(db, 'A', 'update public.rooms set host_id = $1', [USERS.B]), /permission denied/);
    assert.match(await errorOf(db, null, 'select public.auto_transfer_host($1)', [room.code]), /permission denied/);
    assert.match(await errorOf(db, 'A', 'select public.wp_lease_is_live($1, $2)', [room.id, USERS.A]), /permission denied/);
    const published = (await db.query(`select count(*)::int as n from pg_publication_tables where tablename = 'room_connection_leases'`)).rows[0].n;
    assert.equal(published, 0, 'leases are not broadcast');
  });

  await t.test('rollback restores the Stage 1 leave_room and re-applies', async () => {
    await db.query('set role owner_role');
    await db.exec(STAGE3B_ROLLBACK);
    await db.query('reset role');
    assert.equal((await db.query(`select to_regprocedure('public.auto_transfer_host(text)') as f`)).rows[0].f, null);
    assert.ok((await migrate(db, STAGE3B)).ok);
    assert.equal(await legacySnapshot(db), before);
  });

  await db.close();
});

test('lease renewal: caller only, server time', async () => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);
  await renew(db, 'B', room.code);
  const rows = (await db.query('select user_id from public.room_connection_leases where room_id = $1', [room.id])).rows;
  assert.deepEqual(rows.map((r) => r.user_id), [USERS.B], "B renews only B's lease");
  assert.match(await errorOf(db, 'C', 'select public.renew_connection_lease($1)', [room.code]), /not a member/);
  const beat = (await db.query('select count(*)::int as n from public.room_presence_heartbeats where room_id = $1 and user_id = $2', [room.id, USERS.B])).rows[0].n;
  assert.equal(beat, 1, 'a renewal also counts as a Stage 3 heartbeat');
  await db.close();
});

test('automatic transfer scenarios', async (t) => {
  const db = await createMigratedDb();

  await t.test('malicious early takeover: host connected → nothing happens, however often guests ask', async () => {
    const room = await connectedRoom(db, 'Early');
    for (let i = 0; i < 5; i++) {
      for (const who of ['B', 'C']) assert.equal((await autoTransfer(db, who, room.code)).host_id, USERS.A);
    }
    assert.equal(await hostOf(db, room.id), USERS.A);
    assert.deepEqual(await hostFlags(db, room.id), [USERS.A]);
  });

  await t.test('host refreshes the page (lease 8 s old, then renewed) → keeps hosting', async () => {
    const room = await connectedRoom(db, 'Refresh');
    await ageLease(db, room.id, USERS.A, 8); // mid-reload
    assert.equal((await autoTransfer(db, 'B', room.code)).host_id, USERS.A);
    await renew(db, 'A', room.code); // page is back
    assert.equal((await autoTransfer(db, 'B', room.code)).host_id, USERS.A);
  });

  await t.test('host closes the tab / loses internet / crashes (no renewal for 12 s) → longest-present connected guest becomes host', async () => {
    const room = await connectedRoom(db, 'Closed');
    await ageLease(db, room.id, USERS.A, 13);
    const after = await autoTransfer(db, 'C', room.code); // C asks, but B joined first
    assert.equal(after.host_id, USERS.B, 'successor is chosen by the server, not the caller');
    assert.deepEqual(await hostFlags(db, room.id), [USERS.B], 'exactly one host flag');
  });

  await t.test('successor must be connected: a disconnected earlier guest is skipped', async () => {
    const room = await connectedRoom(db, 'Skip');
    await ageLease(db, room.id, USERS.A, 30);
    await ageLease(db, room.id, USERS.B, 30); // B also gone
    assert.equal((await autoTransfer(db, 'C', room.code)).host_id, USERS.C);
  });

  await t.test('nobody connected → room waits, no change', async () => {
    const room = await connectedRoom(db, 'Empty');
    for (const id of [USERS.A, USERS.B, USERS.C]) await ageLease(db, room.id, id, 60);
    assert.equal((await autoTransfer(db, 'B', room.code)).host_id, USERS.A);
  });

  await t.test('several guests ask at once → one transfer, then no-ops', async () => {
    const room = await connectedRoom(db, 'Race');
    await joinRoom(db, 'D', room.code);
    await renew(db, 'D', room.code);
    await ageLease(db, room.id, USERS.A, 20);
    const results = [];
    for (const who of ['D', 'C', 'B', 'D', 'C']) results.push((await autoTransfer(db, who, room.code)).host_id);
    assert.deepEqual(results, Array(5).fill(USERS.B), 'everyone ends up with the same, single host');
    assert.deepEqual(await hostFlags(db, room.id), [USERS.B]);
  });

  await t.test('previous host reconnects → normal member, does not regain hosting', async () => {
    const room = await connectedRoom(db, 'Reconnect');
    await ageLease(db, room.id, USERS.A, 15);
    await autoTransfer(db, 'B', room.code);
    await joinRoom(db, 'A', room.code); // A comes back
    await renew(db, 'A', room.code);
    assert.equal((await autoTransfer(db, 'A', room.code)).host_id, USERS.B);
    assert.equal((await autoTransfer(db, 'C', room.code)).host_id, USERS.B);
    const a = (await db.query('select is_host from public.room_members where room_id = $1 and user_id = $2', [room.id, USERS.A])).rows[0];
    assert.equal(a.is_host, false);
    assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]), /Only the host/);
  });

  await t.test('playback continues after transfer; the new host controls it', async () => {
    const room = await connectedRoom(db, 'Playback');
    const playing = (await as(db, 'A', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', true, 120])).rows[0];
    await as(db, 'A', 'select public.playlist_add($1, $2)', [room.code, 'movie-3']);
    await ageLease(db, room.id, USERS.A, 15);
    await autoTransfer(db, 'C', room.code);
    const state = (await as(db, 'B', 'select movie_id, is_playing, position_sec, version from public.room_playback')).rows[0];
    assert.deepEqual([state.movie_id, state.is_playing, state.position_sec, String(state.version)],
      ['movie-2', true, 120, String(playing.version)], 'shared state untouched by the transfer');
    await as(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', false, 130]);
    await as(db, 'B', 'select public.playlist_add($1, $2)', [room.code, 'movie-4']);
    await as(db, 'B', 'select public.create_poll($1, $2, $3)', [room.code, 'Next?', ['a', 'b']]);
    assert.match(await errorOf(db, 'A', 'select public.playlist_add($1, $2)', [room.code, 'movie-5']), /Only the host/);
  });

  await t.test('host on an older app (no lease at all) is never auto-transferred', async () => {
    const room = await createRoom(db, 'A', 'Old client');
    await joinRoom(db, 'B', room.code);
    await renew(db, 'B', room.code); // only B runs the new app
    assert.equal((await autoTransfer(db, 'B', room.code)).host_id, USERS.A);
  });

  await t.test('host whose membership is gone → connected member takes over', async () => {
    const room = await connectedRoom(db, 'Gone');
    await db.query('delete from public.room_members where room_id = $1 and user_id = $2', [room.id, USERS.A]);
    assert.equal((await autoTransfer(db, 'C', room.code)).host_id, USERS.B);
  });

  await t.test('outsiders cannot trigger; legacy rooms are untouched', async () => {
    const room = await connectedRoom(db, 'Outsider');
    await ageLease(db, room.id, USERS.A, 30);
    assert.match(await errorOf(db, 'D', 'select public.auto_transfer_host($1)', [room.code]), /not a member/);
    await db.query(`insert into public.room_members (room_id, user_id, name, avatar, color)
                    values ('11111111-1111-4111-8111-111111111111', $1, 'D', '', '#112233')`, [USERS.D]);
    assert.equal((await autoTransfer(db, 'D', 'FILM-404')).host_id, 'usr_abc_123');
  });

  await db.close();
});

test('Leave Room hands over to a connected member first', async () => {
  const db = await createMigratedDb();
  const room = await connectedRoom(db, 'Leave');
  await ageLease(db, room.id, USERS.B, 60); // B (earliest guest) is not connected
  await as(db, 'A', 'select public.leave_room($1)', [room.code]);
  assert.equal(await hostOf(db, room.id), USERS.C, 'connected C preferred over disconnected B');
  const leases = (await db.query('select user_id from public.room_connection_leases where room_id = $1', [room.id])).rows.map((r) => r.user_id);
  assert.ok(!leases.includes(USERS.A), "leaver's lease removed");
  await db.close();
});

test('locks serialize renewals with transfers', async () => {
  const db = await createMigratedDb();
  const def = async (sig) => (await db.query('select pg_get_functiondef($1::regprocedure) as d', [sig])).rows[0].d;
  assert.match(await def('public.auto_transfer_host(text)'), /for no key update/);
  assert.match(await def('public.renew_connection_lease(text)'), /for share/);
  assert.match(await def('public.leave_room(text)'), /for no key update/);
  // A renewal holds its lock until it commits
  const room = await createRoom(db, 'A');
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS.A]);
    await db.query('set local role authenticated');
    await db.query('select public.renew_connection_lease($1)', [room.code]);
    await db.query('reset role');
    const locked = (await db.query('select xmax::text <> $2 as l from public.rooms where id = $1', [room.id, '0'])).rows[0].l;
    assert.equal(locked, true);
  } finally {
    await db.exec('rollback');
  }
  // Existing Stage 3 manual takeover still works alongside
  const other = await createRoom(db, 'C', 'Manual');
  await joinRoom(db, 'D', other.code);
  assert.match(await errorOf(db, 'D', 'select public.claim_host($1)', [other.code]), /still connected/);
  await as(db, 'D', 'update public.room_members set avatar = $1 where user_id = $2', [PROFILE.avatar, USERS.D]);
  await db.close();
});
