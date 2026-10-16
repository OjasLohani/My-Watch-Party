// Stage 2 migration: playback, chat, queue, polls, Realtime authorization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE2, STAGE2_ROLLBACK, USERS,
  createDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

test('Stage 2 shared room features', async (t) => {
  const db = await createDb();
  const before = await legacySnapshot(db);

  await t.test('refuses to run before Stage 1', async () => {
    const result = await migrate(db, STAGE2);
    assert.equal(result.ok, false);
    assert.match(result.error, /run the Stage 1 migration first/);
  });

  await t.test('applies after Stage 1 (and re-runs safely)', async () => {
    assert.ok((await migrate(db, STAGE1)).ok);
    const first = await migrate(db, STAGE2);
    assert.ok(first.ok, first.error);
    const second = await migrate(db, STAGE2);
    assert.ok(second.ok, second.error);
    assert.equal(await legacySnapshot(db), before);
  });

  // A hosts, B is a member, C is an outsider.
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);
  const otherRoom = await createRoom(db, 'C', 'Other Room');

  await t.test('playback: host controls, server stamps time and version', async () => {
    const t0 = Date.now();
    const { rows } = await as(db, 'A', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', true, 12.5]);
    const pb = rows[0];
    assert.equal(pb.movie_id, 'movie-2');
    assert.equal(pb.is_playing, true);
    assert.equal(pb.position_sec, 12.5);
    assert.equal(Number(pb.version), 1);
    assert.ok(Math.abs(pb.updated_at_ms - t0) < 5000, 'server timestamp is epoch ms');

    const second = (await as(db, 'A', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', false, 20])).rows[0];
    assert.equal(Number(second.version), 2, 'version increments');

    const roomRow = (await db.query('select current_movie_id from public.rooms where id = $1', [room.id])).rows[0];
    assert.equal(roomRow.current_movie_id, 'movie-2', 'room movie follows playback');

    const seen = (await as(db, 'B', 'select movie_id, position_sec from public.room_playback')).rows;
    assert.deepEqual(seen, [{ movie_id: 'movie-2', position_sec: 20 }], 'members read playback');
  });

  await t.test('playback: non-hosts, outsiders and bad input are refused', async () => {
    assert.match(await errorOf(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]), /Only the host/);
    assert.match(await errorOf(db, 'C', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]), /not a member/);
    assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, -1]), /Invalid playback position/);
    assert.match(await errorOf(db, 'A', `select public.set_playback($1, $2, $3, 'NaN'::float8)`, [room.code, 'movie-1', true]), /Invalid playback position/);
    assert.match(await errorOf(db, 'B', 'update public.room_playback set is_playing = true'), /permission denied/);
    assert.equal((await as(db, 'C', 'select * from public.room_playback where room_id = $1', [room.id])).rows.length, 0);
  });

  await t.test('playback: new host takes over control after transfer', async () => {
    await as(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.B]);
    assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', true, 1]), /Only the host/);
    await as(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-2', true, 1]);
    await as(db, 'B', 'select public.transfer_host($1, $2)', [room.code, USERS.A]);
  });

  await t.test('chat: members post as themselves, history is room-scoped', async () => {
    await as(db, 'A', 'select public.send_message($1, $2)', [room.code, '  Hello room  ']);
    await as(db, 'B', 'select public.send_message($1, $2)', [room.code, 'Hi!']);
    const { rows } = await as(db, 'B', 'select user_id, user_name, body from public.room_messages order by id');
    assert.deepEqual(rows, [
      { user_id: USERS.A, user_name: 'User A', body: 'Hello room' },
      { user_id: USERS.B, user_name: 'User B', body: 'Hi!' },
    ]);
    assert.equal((await as(db, 'C', 'select * from public.room_messages')).rows.length, 0, 'outsider sees no chat');
    assert.match(await errorOf(db, 'C', 'select public.send_message($1, $2)', [room.code, 'spam']), /not a member/);
    assert.match(await errorOf(db, 'B', 'select public.send_message($1, $2)', [room.code, '   ']), /1–500/);
    assert.match(await errorOf(db, 'B', 'insert into public.room_messages (room_id, user_id, user_name, body) values ($1, $2, $3, $4)',
      [room.id, USERS.A, 'User A', 'fake']), /permission denied/, 'cannot insert as someone else');
  });

  await t.test('chat: rate limit', async () => {
    for (let i = 0; i < 9; i++) await as(db, 'B', 'select public.send_message($1, $2)', [room.code, `m${i}`]);
    assert.match(await errorOf(db, 'B', 'select public.send_message($1, $2)', [room.code, 'too many']), /too quickly/);
  });

  await t.test('queue: host adds, reorders, removes; duplicates refused', async () => {
    const add = async (movie) => (await as(db, 'A', 'select * from public.playlist_add($1, $2)', [room.code, movie])).rows[0];
    const one = await add('movie-1');
    const two = await add('movie-3');
    const three = await add('movie-4');
    assert.equal(one.added_by_name, 'User A');
    assert.match(await errorOf(db, 'A', 'select public.playlist_add($1, $2)', [room.code, 'movie-3']), /already in the queue/);

    await as(db, 'A', 'select public.playlist_move($1, $2, $3)', [room.code, three.id, -1]);
    const order = async () => (await as(db, 'B', 'select movie_id from public.room_playlist_items order by position')).rows.map((r) => r.movie_id);
    assert.deepEqual(await order(), ['movie-1', 'movie-4', 'movie-3']);
    await as(db, 'A', 'select public.playlist_move($1, $2, $3)', [room.code, one.id, -1]);
    assert.deepEqual(await order(), ['movie-1', 'movie-4', 'movie-3'], 'moving the first item up is a no-op');

    await as(db, 'A', 'select public.playlist_remove($1, $2)', [room.code, two.id]);
    assert.deepEqual(await order(), ['movie-1', 'movie-4']);
  });

  await t.test('queue: members and outsiders cannot change it', async () => {
    const item = (await as(db, 'B', 'select id from public.room_playlist_items limit 1')).rows[0];
    assert.match(await errorOf(db, 'B', 'select public.playlist_add($1, $2)', [room.code, 'movie-5']), /Only the host/);
    assert.match(await errorOf(db, 'B', 'select public.playlist_remove($1, $2)', [room.code, item.id]), /Only the host/);
    assert.match(await errorOf(db, 'B', 'select public.playlist_move($1, $2, $3)', [room.code, item.id, 1]), /Only the host/);
    assert.match(await errorOf(db, 'C', 'select public.playlist_remove($1, $2)', [otherRoom.code, item.id]), /not found/,
      "a host cannot remove another room's item via their own room");
    assert.match(await errorOf(db, 'B', 'delete from public.room_playlist_items'), /permission denied/);
  });

  await t.test('polls: host creates; members vote once; results visible to members', async () => {
    const poll = (await as(db, 'A', 'select * from public.create_poll($1, $2, $3)',
      [room.code, 'Next film?', ['Sintel', '  ', 'Cosmos', 'Tears']])).rows[0];
    assert.deepEqual(poll.options, ['Sintel', 'Cosmos', 'Tears'], 'blank options are dropped');

    await as(db, 'A', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 0]);
    await as(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 2]);
    assert.match(await errorOf(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 1]), /already voted/);
    assert.match(await errorOf(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 3]), /Invalid option/);
    assert.match(await errorOf(db, 'C', 'select public.vote_poll($1, $2, $3)', [room.code, poll.id, 0]), /not a member/);
    assert.match(await errorOf(db, 'B', 'insert into public.room_poll_votes (poll_id, room_id, user_id, option_index) values ($1, $2, $3, 0)',
      [poll.id, room.id, USERS.C]), /permission denied/);

    const votes = (await as(db, 'B', 'select option_index from public.room_poll_votes where poll_id = $1 order by option_index', [poll.id])).rows;
    assert.deepEqual(votes.map((v) => v.option_index), [0, 2]);
    assert.equal((await as(db, 'C', 'select * from public.room_poll_votes')).rows.length, 0);
  });

  await t.test('polls: only the host creates/closes; one active poll per room', async () => {
    assert.match(await errorOf(db, 'B', 'select public.create_poll($1, $2, $3)', [room.code, 'Q?', ['a', 'b']]), /Only the host/);
    assert.match(await errorOf(db, 'A', 'select public.create_poll($1, $2, $3)', [room.code, 'Q?', ['only one']]), /2–6 options/);
    const second = (await as(db, 'A', 'select * from public.create_poll($1, $2, $3)', [room.code, 'Snacks?', ['Popcorn', 'Nachos']])).rows[0];
    const active = (await as(db, 'B', 'select id from public.room_polls where is_active')).rows;
    assert.deepEqual(active.map((p) => p.id), [second.id], 'creating a poll closes the previous one');
    assert.match(await errorOf(db, 'B', 'select public.close_poll($1, $2)', [room.code, second.id]), /Only the host/);
    await as(db, 'A', 'select public.close_poll($1, $2)', [room.code, second.id]);
    assert.match(await errorOf(db, 'B', 'select public.vote_poll($1, $2, $3)', [room.code, second.id, 0]), /closed/);
  });

  await t.test('realtime: only members can join or send on a room channel', async () => {
    const topic = `room:${room.id}`;
    await db.query(`insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{}')`, [topic]);
    const canJoin = async (who, t2) => (await as(db, who, 'select 1 from realtime.messages', [], { topic: t2 })).rows.length > 0;
    assert.equal(await canJoin('A', topic), true, 'host can join');
    assert.equal(await canJoin('B', topic), true, 'member can join');
    assert.equal(await canJoin('C', topic), false, 'outsider cannot join');
    assert.equal(await canJoin('B', 'chat:anything'), false, 'other topics are not opened up');

    const send = (who, extension = 'broadcast') => errorOf(db, who,
      `insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}')`, [topic, extension], { topic });
    assert.equal(await send('B'), null, 'member can broadcast');
    assert.equal(await send('B', 'presence'), null, 'member can track presence');
    assert.match(await send('C'), /row-level security/, 'outsider cannot broadcast');
    assert.match(await send('D'), /row-level security/, 'signed-in non-member cannot broadcast');
  });

  await t.test('leaving a room revokes access to its data', async () => {
    await as(db, 'B', 'select public.leave_room($1)', [room.code]);
    assert.equal((await as(db, 'B', 'select * from public.room_messages')).rows.length, 0);
    assert.equal((await as(db, 'B', 'select * from public.room_playback')).rows.length, 0);
    assert.match(await errorOf(db, 'B', 'select public.send_message($1, $2)', [room.code, 'still here?']), /not a member/);
  });

  await t.test('rollback removes Stage 2 only; Stage 1 and legacy rows intact', async () => {
    await db.query('set role owner_role');
    await db.exec(STAGE2_ROLLBACK);
    await db.query('reset role');
    assert.equal((await db.query(`select to_regclass('public.room_messages') as t`)).rows[0].t, null);
    assert.equal((await as(db, 'A', 'select count(*)::int as n from public.rooms')).rows[0].n, 1);
    assert.equal(await legacySnapshot(db), before);
    assert.ok((await migrate(db, STAGE2)).ok, 're-applies after rollback');
  });

  await db.close();
});
