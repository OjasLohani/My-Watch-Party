// Stage 3 migration: heartbeats and taking over from an absent host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE2, STAGE3, STAGE3_ROLLBACK, USERS, PROFILE,
  createDb, createMigratedDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

const hostOf = async (db, roomId) =>
  (await db.query('select host_id from public.rooms where id = $1', [roomId])).rows[0].host_id;

const claim = (db, who, code) => errorOf(db, who, 'select public.claim_host($1)', [code]);

/**
 * Pretends the host's last activity of every kind was `minutes` ago:
 * heartbeat, membership times, room update, playback command, chat.
 */
async function ageHostActivity(db, room, hostId, minutes) {
  const ago = `now() - make_interval(mins => ${Number(minutes)})`;
  await db.query(`update public.room_members set last_seen_at = ${ago}, created_at = ${ago}
                  where room_id = $1 and user_id = $2`, [room.id, hostId]);
  await db.query(`update public.rooms set updated_at = ${ago} where id = $1`, [room.id]);
  await db.query(`update public.room_presence_heartbeats set last_seen_at = ${ago} where room_id = $1 and user_id = $2`, [room.id, hostId]);
  await db.query(`update public.room_playback set updated_at_ms = extract(epoch from ${ago}) * 1000
                  where room_id = $1 and updated_by = $2`, [room.id, hostId]);
  await db.query(`update public.room_messages set created_at = ${ago} where room_id = $1 and user_id = $2`, [room.id, hostId]);
}

const STILL_CONNECTED = /still connected/;

test('migration: order, re-runs, data and permissions', async (t) => {
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
    assert.equal(await legacySnapshot(db), before, 'existing rows unchanged');
  });

  await t.test('last_seen_at is not writable: column AND table level', async () => {
    const can = async (role, column) =>
      (await db.query(`select has_column_privilege($1, 'public.room_members', $2, 'UPDATE') as ok`, [role, column])).rows[0].ok;
    const tableWide = async (role) =>
      (await db.query(`select has_table_privilege($1, 'public.room_members', 'UPDATE') as ok`, [role])).rows[0].ok;
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await tableWide(role), false, `${role}: no table-wide UPDATE`);
      assert.equal(await can(role, 'last_seen_at'), false, `${role}: last_seen_at`);
      assert.equal(await can(role, 'is_host'), false, `${role}: is_host`);
      assert.equal(await can(role, 'user_id'), false, `${role}: user_id`);
    }
    for (const column of ['name', 'avatar', 'color']) {
      assert.equal(await can('authenticated', column), true, `profile column ${column} stays editable`);
    }

    const room = await createRoom(db, 'A');
    assert.match(await errorOf(db, 'A', `update public.room_members set last_seen_at = now() + interval '1 year' where user_id = $1`, [USERS.A]),
      /permission denied/);
    await as(db, 'A', 'update public.room_members set name = $1, color = $2 where user_id = $3', ['Renamed', '#112233', USERS.A]);
    const row = (await db.query('select name, color from public.room_members where room_id = $1 and user_id = $2', [room.id, USERS.A])).rows[0];
    assert.deepEqual(row, { name: 'Renamed', color: '#112233' });
  });

  await t.test('the heartbeat table is private and not broadcast', async () => {
    assert.match(await errorOf(db, 'A', 'select * from public.room_presence_heartbeats'), /permission denied/);
    assert.match(await errorOf(db, 'A', `insert into public.room_presence_heartbeats values ('11111111-1111-4111-8111-111111111111', 'x', now())`),
      /permission denied/);
    const published = (await db.query(`select count(*)::int as n from pg_publication_tables
                                       where pubname = 'supabase_realtime' and tablename = 'room_presence_heartbeats'`)).rows[0].n;
    assert.equal(published, 0);
  });

  await t.test('rollback restores Stage 1 rights; migration re-applies', async () => {
    await db.query('set role owner_role');
    await db.exec(STAGE3_ROLLBACK);
    await db.query('reset role');
    assert.equal((await db.query(`select to_regprocedure('public.claim_host(text)') as f`)).rows[0].f, null);
    await as(db, 'A', 'update public.room_members set last_seen_at = now() where user_id = $1', [USERS.A]);
    assert.ok((await migrate(db, STAGE3)).ok);
    assert.equal(await legacySnapshot(db), before);
  });

  await db.close();
});

test('a table-wide UPDATE grant made by hand is removed too', async () => {
  const db = await createDb();
  assert.ok((await migrate(db, STAGE1)).ok);
  assert.ok((await migrate(db, STAGE2)).ok);
  await db.exec('grant update on table public.room_members to authenticated'); // e.g. a dashboard click
  assert.ok((await migrate(db, STAGE3)).ok);
  const room = await createRoom(db, 'A');
  assert.match(await errorOf(db, 'A', 'update public.room_members set last_seen_at = now() where user_id = $1', [USERS.A]), /permission denied/);
  assert.match(await errorOf(db, 'A', 'update public.room_members set is_host = true where user_id = $1', [USERS.A]), /permission denied/);
  await as(db, 'A', 'update public.room_members set name = $1 where user_id = $2', ['Still editable', USERS.A]);
  assert.ok(room);
  await db.close();
});

test('heartbeat: caller only, server time, throttled', async () => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);
  const beats = async () => Object.fromEntries((await db.query(
    'select user_id, last_seen_at from public.room_presence_heartbeats where room_id = $1', [room.id])).rows
    .map((r) => [r.user_id, r.last_seen_at]));

  await as(db, 'B', 'select public.touch_room($1)', [room.code]);
  const first = await beats();
  assert.deepEqual(Object.keys(first), [USERS.B], "B's heartbeat only — never A's");

  await as(db, 'B', 'select public.touch_room($1)', [room.code]);
  assert.equal((await beats())[USERS.B].getTime(), first[USERS.B].getTime(), 'repeat within 10 s is not written again');

  assert.match(await errorOf(db, 'C', 'select public.touch_room($1)', [room.code]), /not a member/);
  assert.match(await errorOf(db, null, 'select public.touch_room($1)', [room.code]), /permission denied/);
  await db.close();
});

test('claim_host: when a takeover is allowed', async (t) => {
  const db = await createMigratedDb();

  await t.test('brand-new room: host is protected', async () => {
    const room = await createRoom(db, 'A');
    await joinRoom(db, 'B', room.code);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED);
  });

  await t.test('host who never sent a heartbeat (NULL) but joined recently is protected', async () => {
    const room = await createRoom(db, 'C', 'Never beat');
    await joinRoom(db, 'D', room.code);
    await db.query('update public.room_members set last_seen_at = null where room_id = $1', [room.id]);
    assert.match(await claim(db, 'D', room.code), STILL_CONNECTED);
  });

  await t.test('host who just received the role is protected, even if they joined long ago', async () => {
    const room = await createRoom(db, 'A', 'Transfer');
    await joinRoom(db, 'B', room.code);
    await joinRoom(db, 'C', room.code);
    await ageHostActivity(db, room, USERS.B, 60); // B joined an hour ago, no heartbeats
    await as(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.B]);
    assert.match(await claim(db, 'C', room.code), STILL_CONNECTED, 'new host B cannot be replaced immediately');
  });

  await t.test('host active only through playback or chat is protected (older app version)', async () => {
    const room = await createRoom(db, 'A', 'Activity');
    await joinRoom(db, 'B', room.code);
    await ageHostActivity(db, room, USERS.A, 10);
    await as(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 5]);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED, 'recent playback command');

    await ageHostActivity(db, room, USERS.A, 10);
    await as(db, 'A', 'select public.send_message($1, $2)', [room.code, 'still here']);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED, 'recent chat message');
  });

  await t.test('2 minutes of silence is not enough; heartbeat resets the clock', async () => {
    const room = await createRoom(db, 'A', 'Timing');
    await joinRoom(db, 'B', room.code);
    await ageHostActivity(db, room, USERS.A, 2);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED);
    await ageHostActivity(db, room, USERS.A, 10);
    await as(db, 'A', 'select public.touch_room($1)', [room.code]);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED);
  });

  await t.test('after 3 minutes without any activity a member takes over', async () => {
    const room = await createRoom(db, 'A', 'Absent');
    await joinRoom(db, 'B', room.code);
    await ageHostActivity(db, room, USERS.A, 4);
    assert.equal(await claim(db, 'B', room.code), null);
    assert.equal(await hostOf(db, room.id), USERS.B);
    const flags = (await db.query('select user_id, is_host from public.room_members where room_id = $1', [room.id])).rows;
    assert.equal(flags.find((f) => f.user_id === USERS.B).is_host, true);
    assert.equal(flags.find((f) => f.user_id === USERS.A).is_host, false);
    assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]), /Only the host/);
  });

  await t.test('host with no recorded activity at all can be replaced (documented)', async () => {
    const room = await createRoom(db, 'A', 'No record');
    await joinRoom(db, 'B', room.code);
    await db.query('update public.room_members set last_seen_at = null, created_at = null where room_id = $1 and user_id = $2', [room.id, USERS.A]);
    await db.query('update public.rooms set updated_at = null where id = $1', [room.id]);
    assert.equal(await claim(db, 'B', room.code), null);
  });

  await t.test('host whose membership is gone can be replaced at once', async () => {
    const room = await createRoom(db, 'A', 'Gone');
    await joinRoom(db, 'B', room.code);
    await db.query('delete from public.room_members where room_id = $1 and user_id = $2', [room.id, USERS.A]);
    assert.equal(await claim(db, 'B', room.code), null);
    assert.equal(await hostOf(db, room.id), USERS.B);
  });

  await t.test('legacy rooms cannot be taken over', async () => {
    await db.query(`insert into public.room_members (room_id, user_id, name, avatar, color)
                    values ('11111111-1111-4111-8111-111111111111', $1, 'C', '', '#112233')`, [USERS.C]);
    assert.match(await claim(db, 'C', 'FILM-404'), /before secure accounts/);
    assert.equal(await hostOf(db, '11111111-1111-4111-8111-111111111111'), 'usr_abc_123');
  });

  await t.test('outsiders and signed-out users cannot claim', async () => {
    const room = await createRoom(db, 'A', 'Outsiders');
    await ageHostActivity(db, room, USERS.A, 10);
    assert.match(await claim(db, 'C', room.code), /not a member/);
    assert.match(await claim(db, null, room.code), /permission denied/);
  });

  await t.test('claiming when already host is a no-op', async () => {
    const room = await createRoom(db, 'D', 'Self');
    assert.equal(await claim(db, 'D', room.code), null);
    assert.equal(await hostOf(db, room.id), USERS.D);
  });

  await db.close();
});

test('claim_host vs other actions (each order of two competing actions)', async (t) => {
  const db = await createMigratedDb();

  async function absentHostRoom(name) {
    const room = await createRoom(db, 'A', name);
    await joinRoom(db, 'B', room.code);
    await joinRoom(db, 'C', room.code);
    await ageHostActivity(db, room, USERS.A, 10);
    return room;
  }

  await t.test('claim then claim: the second claimer is refused', async () => {
    const room = await absentHostRoom('Double claim');
    assert.equal(await claim(db, 'B', room.code), null);
    assert.match(await claim(db, 'C', room.code), STILL_CONNECTED, 'B just became host');
    assert.equal(await hostOf(db, room.id), USERS.B);
  });

  await t.test('claim then old host transfers: refused (no longer host)', async () => {
    const room = await absentHostRoom('Claim first');
    assert.equal(await claim(db, 'B', room.code), null);
    assert.match(await errorOf(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.C]), /Only the current host/);
  });

  await t.test('transfer then claim: the new host is protected', async () => {
    const room = await absentHostRoom('Transfer first');
    await as(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.C]);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED);
    assert.equal(await hostOf(db, room.id), USERS.C);
  });

  await t.test('host leaves then claim: the automatic successor is protected', async () => {
    const room = await absentHostRoom('Leave first');
    await as(db, 'A', 'select public.leave_room($1)', [room.code]);
    const successor = await hostOf(db, room.id);
    const other = successor === USERS.B ? 'C' : 'B';
    assert.match(await claim(db, other, room.code), STILL_CONNECTED);
    assert.equal(await hostOf(db, room.id), successor);
  });

  await t.test('claim then the old host leaves: nothing breaks', async () => {
    const room = await absentHostRoom('Claim then leave');
    assert.equal(await claim(db, 'B', room.code), null);
    await as(db, 'A', 'select public.leave_room($1)', [room.code]);
    assert.equal(await hostOf(db, room.id), USERS.B);
  });

  await t.test('heartbeat then claim: refused', async () => {
    const room = await absentHostRoom('Heartbeat first');
    await as(db, 'A', 'select public.touch_room($1)', [room.code]);
    assert.match(await claim(db, 'B', room.code), STILL_CONNECTED);
  });

  await t.test('locks that serialize these actions are in place', async () => {
    const def = async (signature) =>
      (await db.query(`select pg_get_functiondef($1::regprocedure) as d`, [signature])).rows[0].d;
    assert.match(await def('public.claim_host(text)'), /for no key update/);
    assert.match(await def('public.touch_room(text)'), /for share/, 'heartbeat waits for / is seen by a claim');
    assert.match(await def('public.transfer_host(text,text)'), /for no key update/);
    assert.match(await def('public.leave_room(text)'), /for no key update/);
  });

  await t.test('a heartbeat holds its lock until it commits', async () => {
    const room = await createRoom(db, 'A', 'Lock held');
    await db.exec('begin');
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS.A]);
      await db.query('set local role authenticated');
      await db.query('select public.touch_room($1)', [room.code]);
      await db.query('reset role');
      const locked = (await db.query('select xmax::text <> $2 as locked from public.rooms where id = $1', [room.id, '0'])).rows[0].locked;
      assert.equal(locked, true, 'room row is locked by the open heartbeat transaction');
    } finally {
      await db.exec('rollback');
    }
  });

  await db.close();
});

test('re-applying Stage 3 on a room in use keeps profile editing working', async () => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);
  assert.ok((await migrate(db, STAGE3)).ok, 're-applies cleanly');
  await as(db, 'B', 'update public.room_members set avatar = $1 where user_id = $2', [PROFILE.avatar, USERS.B]);
  await db.close();
});
