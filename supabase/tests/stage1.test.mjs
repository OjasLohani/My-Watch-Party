// Stage 1 migration: data preservation, RLS, room functions, host rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE1_ROLLBACK, USERS, PROFILE,
  createDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

for (const withKeys of [true, false]) {
  test(`Stage 1 on existing schema ${withKeys ? 'with' : 'without'} unique/foreign keys`, async (t) => {
    const db = await createDb({ withKeys });
    const before = await legacySnapshot(db);

    await t.test('applies, replaces the open policies, keeps legacy rows', async () => {
      const result = await migrate(db, STAGE1);
      assert.ok(result.ok, result.error);
      assert.equal(result.notices.filter((n) => n.startsWith('Dropping policy')).length, 3);
      const { rows } = await db.query(
        `select policyname from pg_policies where schemaname = 'public' order by 1`);
      assert.deepEqual(rows.map((r) => r.policyname), [
        'Members can update their own profile', 'Members can view fellow members', 'Members can view their rooms',
      ]);
      assert.equal(await legacySnapshot(db), before);
    });

    await t.test('is safe to re-run', async () => {
      const result = await migrate(db, STAGE1);
      assert.ok(result.ok, result.error);
      assert.equal(await legacySnapshot(db), before);
    });

    const room = await createRoom(db, 'A');
    await joinRoom(db, 'B', room.code.toLowerCase());

    await t.test('guests create and join; host comes from the server', async () => {
      assert.match(room.code, /^[A-Z]{2,10}-[2-9A-HJKMNP-Z]{6}$/);
      assert.equal(room.host_id, USERS.A);
      const { rows } = await as(db, 'B', 'select user_id, is_host from public.room_members order by created_at');
      assert.equal(rows.length, 2);
      assert.equal(rows.find((m) => m.user_id === USERS.B).is_host, false);
    });

    await t.test('outsiders and anon see nothing; legacy rooms are hidden', async () => {
      assert.equal((await as(db, 'C', 'select * from public.rooms')).rows.length, 0);
      assert.equal((await as(db, 'C', 'select * from public.room_members')).rows.length, 0);
      assert.equal((await as(db, 'B', 'select * from public.rooms')).rows.length, 1);
      assert.match(await errorOf(db, null, 'select * from public.rooms'), /permission denied/);
      assert.match(await errorOf(db, null, `select public.create_room('x','m',false,'A','','#112233')`), /permission denied/);
    });

    await t.test('direct writes are blocked', async () => {
      assert.match(await errorOf(db, 'B', 'update public.rooms set host_id = $1', [USERS.B]), /permission denied/);
      assert.match(await errorOf(db, 'B', 'delete from public.room_members'), /permission denied/);
      assert.match(await errorOf(db, 'B', 'update public.room_members set is_host = true where user_id = $1', [USERS.B]), /permission denied/);
      assert.match(await errorOf(db, 'B', 'insert into public.room_members (room_id, user_id, name) values ($1, $2, $3)',
        [room.id, USERS.C, 'x']), /permission denied/);
      const renameOther = await as(db, 'B', 'update public.room_members set name = $1 where user_id = $2', ['Hacked', USERS.A]);
      assert.equal(renameOther.affectedRows, 0);
      assert.match(await errorOf(db, 'B', 'select public.wp_generate_room_code()'), /permission denied/);
      assert.match(await errorOf(db, 'B', 'select public.wp_is_auth_user($1)', [USERS.A]), /permission denied/);
    });

    await t.test('host-only operations', async () => {
      assert.match(await errorOf(db, 'B', 'select public.transfer_host($1, $2)', [room.code, USERS.B]), /Only the current host/);
      assert.match(await errorOf(db, 'B', 'select public.set_room_movie($1, $2)', [room.code, 'movie-2']), /Only the host/);
      assert.match(await errorOf(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.C]), /not a member/);
      await as(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.B]);
      const { rows } = await db.query('select host_id from public.rooms where id = $1', [room.id]);
      assert.equal(rows[0].host_id, USERS.B);
      await as(db, 'B', 'select public.leave_room($1)', [room.code]);
      const after = await db.query('select host_id from public.rooms where id = $1', [room.id]);
      assert.equal(after.rows[0].host_id, USERS.A, 'host hands off to the remaining member');
    });

    await t.test('legacy rooms and bad input give clear errors', async () => {
      assert.match(await errorOf(db, 'C', 'select public.join_room($1, $2, $3, $4)',
        ['FILM-404', 'C', PROFILE.avatar, PROFILE.color]), /before secure accounts/);
      assert.match(await errorOf(db, 'C', 'select public.join_room($1, $2, $3, $4)',
        ['FILM-ZZZZZZ', 'C', PROFILE.avatar, PROFILE.color]), /No room found/);
      assert.match(await errorOf(db, 'C', 'select public.join_room($1, $2, $3, $4)',
        [room.code, 'C', PROFILE.avatar, 'red']), /Color must look like/);
      assert.equal(await legacySnapshot(db), before);
    });

    await t.test('rollback restores the old state and the migration re-applies', async () => {
      await db.query('set role owner_role');
      await db.exec(STAGE1_ROLLBACK);
      await db.query('reset role');
      assert.equal(await legacySnapshot(db), before);
      const again = await migrate(db, STAGE1);
      assert.ok(again.ok, again.error);
    });

    await db.close();
  });
}

test('Stage 1 pre-flight aborts with nothing changed when data has duplicates', async () => {
  const db = await createDb({ withKeys: false });
  await db.exec(`insert into public.room_members (room_id, user_id, name)
                 values ('11111111-1111-4111-8111-111111111111', 'usr_q', 'Q dup')`);
  const before = await legacySnapshot(db);
  const result = await migrate(db, STAGE1);
  assert.equal(result.ok, false);
  assert.match(result.error, /duplicate \(room_id, user_id\)/);
  assert.equal(await legacySnapshot(db), before);
  const { rows } = await db.query(`select count(*)::int as n from pg_proc where proname = 'create_room'`);
  assert.equal(rows[0].n, 0);
  await db.close();
});
