// Edge cases for the queue, polls and host transfer during playback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, createMigratedDb, as, errorOf, createRoom, joinRoom } from './helpers.mjs';

test('queue edge cases', async (t) => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  const other = await createRoom(db, 'C', 'Other');
  const add = (who, code, movie) => as(db, who, 'select * from public.playlist_add($1, $2)', [code, movie]);

  await t.test('queue holds at most 50 titles', async () => {
    for (let i = 0; i < 50; i++) await add('A', room.code, `movie-${i}`);
    assert.match(await errorOf(db, 'A', 'select public.playlist_add($1, $2)', [room.code, 'movie-extra']), /queue is full/);
  });

  await t.test('moving the last item down / first item up changes nothing', async () => {
    const order = async () => (await as(db, 'A', 'select id from public.room_playlist_items order by position')).rows.map((r) => r.id);
    const before = await order();
    await as(db, 'A', 'select public.playlist_move($1, $2, 1)', [room.code, before.at(-1)]);
    await as(db, 'A', 'select public.playlist_move($1, $2, -1)', [room.code, before[0]]);
    assert.deepEqual(await order(), before);
  });

  await t.test('bad direction, unknown item and other rooms are refused', async () => {
    const first = (await as(db, 'A', 'select id from public.room_playlist_items order by position limit 1')).rows[0].id;
    assert.match(await errorOf(db, 'A', 'select public.playlist_move($1, $2, 2)', [room.code, first]), /Direction/);
    assert.match(await errorOf(db, 'A', 'select public.playlist_remove($1, $2)', [room.code, 999999]), /not found/);
    const otherItem = (await add('C', other.code, 'movie-1')).rows[0];
    assert.match(await errorOf(db, 'A', 'select public.playlist_remove($1, $2)', [room.code, otherItem.id]), /not found/,
      "cannot remove another room's item");
    assert.match(await errorOf(db, 'A', 'select public.playlist_add($1, $2)', [room.code, '']), /Invalid movie/);
    assert.match(await errorOf(db, 'A', 'select public.playlist_add($1, $2)', [room.code, 'x'.repeat(65)]), /Invalid movie/);
  });

  await db.close();
});

test('poll edge cases', async (t) => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  const other = await createRoom(db, 'C', 'Other');
  await joinRoom(db, 'B', room.code);
  const create = (who, code, q, options) => as(db, who, 'select * from public.create_poll($1, $2, $3)', [code, q, options]);

  await t.test('option limits: 2–6 options, 80 characters each, 200-character question', async () => {
    assert.match(await errorOf(db, 'A', 'select public.create_poll($1, $2, $3)', [room.code, 'Q', ['1', '2', '3', '4', '5', '6', '7']]), /2–6 options/);
    assert.match(await errorOf(db, 'A', 'select public.create_poll($1, $2, $3)', [room.code, 'Q', ['ok', 'x'.repeat(81)]]), /80 characters/);
    assert.match(await errorOf(db, 'A', 'select public.create_poll($1, $2, $3)', [room.code, 'q'.repeat(201), ['a', 'b']]), /question/);
    assert.match(await errorOf(db, 'A', 'select public.create_poll($1, $2, $3)', [room.code, 'Q', ['a', '   ']]), /2–6 options/, 'blank options do not count');
    const six = (await create('A', room.code, 'Six?', ['1', '2', '3', '4', '5', '6'])).rows[0];
    assert.equal(six.options.length, 6);
  });

  await t.test("a vote must use the poll's own room", async () => {
    const otherPoll = (await create('C', other.code, 'Elsewhere?', ['a', 'b'])).rows[0];
    assert.match(await errorOf(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, otherPoll.id, 0]), /closed or does not exist/);
  });

  await t.test('a new poll means a fresh vote; old votes stay with the old poll', async () => {
    const first = (await create('A', room.code, 'First?', ['a', 'b'])).rows[0];
    await as(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, first.id, 0]);
    const second = (await create('A', room.code, 'Second?', ['c', 'd'])).rows[0];
    await as(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, second.id, 1]);
    assert.match(await errorOf(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, first.id, 1]), /closed/);
    const votes = (await db.query('select poll_id, option_index from public.room_poll_votes where user_id = $1 order by poll_id', [USERS.B])).rows;
    assert.deepEqual(votes.map((v) => [String(v.poll_id), v.option_index]), [[String(first.id), 0], [String(second.id), 1]]);
  });

  await t.test('negative and missing options are refused', async () => {
    const poll = (await as(db, 'A', 'select id from public.room_polls where is_active')).rows[0];
    assert.match(await errorOf(db, 'A', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, -1]), /Invalid option/);
    assert.match(await errorOf(db, 'A', 'select public.vote_poll($1, $2, null)', [room.code, poll.id]), /Invalid option/);
  });

  await db.close();
});

test('host transfer during playback keeps the shared state', async () => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);

  const playing = (await as(db, 'A', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', true, 42])).rows[0];
  await as(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.B]);

  const after = (await as(db, 'B', 'select movie_id, is_playing, position_sec, version from public.room_playback')).rows[0];
  assert.deepEqual(
    { movie: after.movie_id, playing: after.is_playing, position: after.position_sec, version: String(after.version) },
    { movie: 'movie-2', playing: true, position: 42, version: String(playing.version) },
    'transfer does not reset or change playback',
  );
  assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', false, 50]), /Only the host/);
  const paused = (await as(db, 'B', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', false, 50])).rows[0];
  assert.equal(String(paused.version), String(Number(playing.version) + 1), 'new host continues the version sequence');
  await db.close();
});
