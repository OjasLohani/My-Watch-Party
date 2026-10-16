// Display names in the database: renaming is limited to your own rows,
// validated by the database, and shown everywhere it is used.
// Uses the exact update the app sends (src/services/roomService.ts
// updateMyDisplayName): update room_members set name = … where user_id = me
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, PROFILE, createMigratedDb, as, errorOf, createRoom, joinRoom } from './helpers.mjs';

const rename = (db, who, name, userId = USERS[who]) =>
  as(db, who, 'update public.room_members set name = $1 where user_id = $2', [name, userId]);

const namesIn = async (db, roomId) => Object.fromEntries((await db.query(
  'select user_id, name from public.room_members where room_id = $1', [roomId])).rows.map((r) => [r.user_id, r.name]));

test('display names', async (t) => {
  const db = await createMigratedDb();
  const roomOne = await createRoom(db, 'A', 'One');
  const roomTwo = await createRoom(db, 'C', 'Two');
  await joinRoom(db, 'B', roomOne.code);
  await joinRoom(db, 'B', roomTwo.code);

  await t.test('the name chosen when joining is stored', async () => {
    await as(db, 'D', 'select public.join_room($1, $2, $3, $4)', [roomOne.code, '  Dana  ', PROFILE.avatar, PROFILE.color]);
    assert.equal((await namesIn(db, roomOne.id))[USERS.D], 'Dana', 'trimmed by the server');
  });

  await t.test('renaming updates all of your rooms, and only yours', async () => {
    const result = await rename(db, 'B', 'Bea');
    assert.equal(result.affectedRows, 2, 'both of B’s memberships');
    assert.equal((await namesIn(db, roomOne.id))[USERS.B], 'Bea');
    assert.equal((await namesIn(db, roomTwo.id))[USERS.B], 'Bea');
    assert.equal((await namesIn(db, roomOne.id))[USERS.A], 'User A', 'A unchanged');
  });

  await t.test("one guest cannot change another guest's name", async () => {
    const attempt = await rename(db, 'B', 'Hacked', USERS.A);
    assert.equal(attempt.affectedRows, 0);
    const blanket = await as(db, 'B', 'update public.room_members set name = $1', ['Everyone']);
    assert.equal(blanket.affectedRows, 2, 'an update without a filter still only reaches B’s own rows');
    assert.equal((await namesIn(db, roomOne.id))[USERS.A], 'User A');
    assert.match(await errorOf(db, null, 'update public.room_members set name = $1', ['anon']), /permission denied/);
    await rename(db, 'B', 'Bea');
  });

  await t.test('the database rejects empty and too-long names', async () => {
    assert.match(await errorOf(db, 'B', 'update public.room_members set name = $1 where user_id = $2', ['   ', USERS.B]), /room_members_name_length/);
    assert.match(await errorOf(db, 'B', 'update public.room_members set name = $1 where user_id = $2', ['x'.repeat(41), USERS.B]), /room_members_name_length/);
    await rename(db, 'B', '🎬'.repeat(40)); // 40 characters
    await rename(db, 'B', 'Bea');
    assert.match(await errorOf(db, 'B', 'select public.join_room($1, $2, $3, $4)', [roomOne.code, '   ', PROFILE.avatar, PROFILE.color]), /Display name/);
  });

  await t.test('renaming cannot change anything else', async () => {
    assert.match(await errorOf(db, 'B', 'update public.room_members set is_host = true where user_id = $1', [USERS.B]), /permission denied/);
    assert.match(await errorOf(db, 'B', 'update public.room_members set user_id = $1 where user_id = $2', [USERS.A, USERS.B]), /permission denied/);
  });

  await t.test('chat uses the current name for new messages', async () => {
    await rename(db, 'B', 'Bee');
    const message = (await as(db, 'B', 'select * from public.send_message($1, $2)', [roomOne.code, 'hi'])).rows[0];
    assert.equal(message.user_name, 'Bee');
  });

  await t.test('names are stored exactly as text (no HTML processing)', async () => {
    const tricky = '<img src=x onerror=alert(1)>';
    await rename(db, 'B', tricky);
    assert.equal((await namesIn(db, roomOne.id))[USERS.B], tricky);
  });

  await db.close();
});
