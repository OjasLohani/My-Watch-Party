// Leaving a room (leave_room, as redefined in Stage 3b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, PROFILE, createMigratedDb, as, errorOf, createRoom, joinRoom } from './helpers.mjs';

const renew = (db, who, code) => as(db, who, 'select public.renew_connection_lease($1)', [code]);
const leave = (db, who, code) => as(db, who, 'select public.leave_room($1)', [code]);
const hostOf = async (db, roomId) => (await db.query('select host_id from public.rooms where id = $1', [roomId])).rows[0].host_id;
const members = async (db, roomId) =>
  (await db.query('select user_id, is_host from public.room_members where room_id = $1 order by created_at', [roomId])).rows;
const leases = async (db, roomId) =>
  (await db.query('select user_id from public.room_connection_leases where room_id = $1', [roomId])).rows.map((r) => r.user_id);

/** Host A with guests B and C, everyone connected (fresh leases) */
async function liveRoom(db, name) {
  const room = await createRoom(db, 'A', name);
  await joinRoom(db, 'B', room.code);
  await joinRoom(db, 'C', room.code);
  for (const who of ['A', 'B', 'C']) await renew(db, who, room.code);
  return room;
}

test('leaving a room', async (t) => {
  const db = await createMigratedDb();

  await t.test('guest leaves: host unchanged, membership and lease removed, data no longer visible', async () => {
    const room = await liveRoom(db, 'Guest leaves');
    await as(db, 'A', 'select public.send_message($1, $2)', [room.code, 'hello']);
    await leave(db, 'C', room.code);
    assert.equal(await hostOf(db, room.id), USERS.A);
    assert.deepEqual((await members(db, room.id)).map((m) => m.user_id), [USERS.A, USERS.B]);
    assert.ok(!(await leases(db, room.id)).includes(USERS.C));
    assert.equal((await as(db, 'C', 'select * from public.room_messages where room_id = $1', [room.id])).rows.length, 0);
    assert.equal((await as(db, 'C', 'select * from public.rooms where id = $1', [room.id])).rows.length, 0);
  });

  await t.test('host leaves: a connected guest becomes host immediately (no lease expiry wait)', async () => {
    const room = await liveRoom(db, 'Host leaves');
    await leave(db, 'A', room.code); // A's lease was fresh: no 12 s wait involved
    assert.equal(await hostOf(db, room.id), USERS.B);
    assert.deepEqual(await members(db, room.id), [
      { user_id: USERS.B, is_host: true },
      { user_id: USERS.C, is_host: false },
    ]);
    // The new host has the controls right away
    await as(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 3]);
    await as(db, 'B', 'select public.playlist_add($1, $2)', [room.code, 'movie-2']);
  });

  await t.test('host leaves: connected guests are preferred over disconnected ones', async () => {
    const room = await liveRoom(db, 'Prefer connected');
    await db.query(`update public.room_connection_leases set renewed_at = now() - interval '1 minute'
                    where room_id = $1 and user_id = $2`, [room.id, USERS.B]);
    await leave(db, 'A', room.code);
    assert.equal(await hostOf(db, room.id), USERS.C);
  });

  await t.test('rejoining through the same code works; a returning host is a normal member', async () => {
    const room = await liveRoom(db, 'Rejoin');
    await leave(db, 'A', room.code);
    await leave(db, 'C', room.code);
    await as(db, 'C', 'select public.join_room($1, $2, $3, $4)', [room.code, 'Cam again', PROFILE.avatar, PROFILE.color]);
    await as(db, 'A', 'select public.join_room($1, $2, $3, $4)', [room.code, 'Ann again', PROFILE.avatar, PROFILE.color]);
    const rows = await members(db, room.id);
    assert.equal(rows.find((m) => m.user_id === USERS.C).is_host, false);
    assert.equal(rows.find((m) => m.user_id === USERS.A).is_host, false, 'former host does not get hosting back');
    assert.equal(await hostOf(db, room.id), USERS.B);
  });

  await t.test('leaving twice, or a room you are not in, is harmless', async () => {
    const room = await liveRoom(db, 'Twice');
    await leave(db, 'C', room.code);
    await leave(db, 'C', room.code); // e.g. a retry after a lost response
    await leave(db, 'D', room.code); // never a member
    await leave(db, 'B', 'FILM-NOROOM'); // unknown code
    assert.equal(await hostOf(db, room.id), USERS.A);
    assert.deepEqual((await members(db, room.id)).map((m) => m.user_id), [USERS.A, USERS.B]);
  });

  await t.test('after leaving, stray lease renewals and transfer checks are refused', async () => {
    const room = await liveRoom(db, 'Stray requests');
    await leave(db, 'C', room.code);
    assert.match(await errorOf(db, 'C', 'select public.renew_connection_lease($1)', [room.code]), /not a member/);
    assert.match(await errorOf(db, 'C', 'select public.auto_transfer_host($1)', [room.code]), /not a member/);
  });

  await t.test('the last person leaving keeps the room for a later return', async () => {
    const room = await createRoom(db, 'D', 'Solo');
    await leave(db, 'D', room.code);
    assert.equal((await members(db, room.id)).length, 0);
    await as(db, 'D', 'select public.join_room($1, $2, $3, $4)', [room.code, 'Dee', PROFILE.avatar, PROFILE.color]);
    assert.deepEqual(await members(db, room.id), [{ user_id: USERS.D, is_host: true }], 'host returns to an empty room as host');
  });

  await t.test('signed-out users cannot call leave_room', async () => {
    assert.match(await errorOf(db, null, 'select public.leave_room($1)', ['FILM-NOROOM']), /permission denied/);
  });

  await db.close();
});
