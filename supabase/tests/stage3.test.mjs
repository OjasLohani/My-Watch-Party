// Stage 3 migration: heartbeat and taking over from an absent host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE2, STAGE3, STAGE3_ROLLBACK, USERS,
  createDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

const hostOf = async (db, roomId) =>
  (await db.query('select host_id from public.rooms where id = $1', [roomId])).rows[0].host_id;

/** Pretend the host was last seen `minutes` ago */
const ageHost = (db, roomId, userId, minutes) =>
  db.query(`update public.room_members set last_seen_at = now() - make_interval(mins => $3)
            where room_id = $1 and user_id = $2`, [roomId, userId, minutes]);

test('Stage 3 host takeover', async (t) => {
  const db = await createDb();
  const before = await legacySnapshot(db);

  await t.test('refuses to run before Stage 2, then applies and re-runs', async () => {
    assert.ok((await migrate(db, STAGE1)).ok);
    const early = await migrate(db, STAGE3);
    assert.equal(early.ok, false);
    assert.match(early.error, /Stage 1 and Stage 2/);
    assert.ok((await migrate(db, STAGE2)).ok);
    assert.ok((await migrate(db, STAGE3)).ok);
    assert.ok((await migrate(db, STAGE3)).ok, 're-run');
    assert.equal(await legacySnapshot(db), before);
  });

  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);

  await t.test('cannot take over while the host is around', async () => {
    assert.match(await errorOf(db, 'B', 'select public.claim_host($1)', [room.code]), /still connected/);
    await ageHost(db, room.id, USERS.A, 2);
    assert.match(await errorOf(db, 'B', 'select public.claim_host($1)', [room.code]), /still connected/, '2 minutes is not enough');
    assert.equal(await hostOf(db, room.id), USERS.A);
  });

  await t.test('the heartbeat keeps the host from being replaced', async () => {
    await ageHost(db, room.id, USERS.A, 10);
    await as(db, 'A', 'select public.touch_room($1)', [room.code]);
    assert.match(await errorOf(db, 'B', 'select public.claim_host($1)', [room.code]), /still connected/);
  });

  await t.test('nobody can fake "still online" by writing last_seen_at', async () => {
    assert.match(await errorOf(db, 'A', `update public.room_members set last_seen_at = now() + interval '1 year'
                                       where user_id = $1`, [USERS.A]), /permission denied/);
    // name / avatar / colour stay editable
    await as(db, 'A', 'update public.room_members set name = $1 where user_id = $2', ['Host A', USERS.A]);
  });

  await t.test('outsiders cannot heartbeat or claim', async () => {
    assert.match(await errorOf(db, 'C', 'select public.touch_room($1)', [room.code]), /not a member/);
    await ageHost(db, room.id, USERS.A, 10);
    assert.match(await errorOf(db, 'C', 'select public.claim_host($1)', [room.code]), /not a member/);
    assert.match(await errorOf(db, null, 'select public.claim_host($1)', [room.code]), /permission denied/);
  });

  await t.test('a member takes over after 3 minutes of silence; the old host loses control', async () => {
    await ageHost(db, room.id, USERS.A, 4);
    await as(db, 'B', 'select public.claim_host($1)', [room.code]);
    assert.equal(await hostOf(db, room.id), USERS.B);
    const flags = (await db.query('select user_id, is_host from public.room_members where room_id = $1', [room.id])).rows;
    assert.equal(flags.find((f) => f.user_id === USERS.B).is_host, true);
    assert.equal(flags.find((f) => f.user_id === USERS.A).is_host, false);
    assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]), /Only the host/);
    await as(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]);
  });

  await t.test('claiming when already host is a no-op', async () => {
    await as(db, 'B', 'select public.claim_host($1)', [room.code]);
    assert.equal(await hostOf(db, room.id), USERS.B);
  });

  await t.test('rollback removes the functions and restores the column right', async () => {
    await db.query('set role owner_role');
    await db.exec(STAGE3_ROLLBACK);
    await db.query('reset role');
    assert.equal((await db.query(`select to_regprocedure('public.claim_host(text)') as f`)).rows[0].f, null);
    await as(db, 'B', 'update public.room_members set last_seen_at = now() where user_id = $1', [USERS.B]);
    assert.ok((await migrate(db, STAGE3)).ok, 're-applies');
  });

  await db.close();
});
