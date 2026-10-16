// Stage 4a: YouTube videos (movie id rule, queue titles, host-only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1, STAGE2, STAGE3, STAGE3B, STAGE4A, STAGE4A_ROLLBACK, USERS,
  createDb, createMigratedDb, migrate, as, errorOf, legacySnapshot, createRoom, joinRoom,
} from './helpers.mjs';

const YT = 'yt:aqz-KE-bpKQ'; // Big Buck Bunny on YouTube
const renew = (db, who, code) => as(db, who, 'select public.renew_connection_lease($1)', [code]);

test('Stage 4a migration: order, re-runs, data, rollback', async () => {
  const db = await createDb();
  const before = await legacySnapshot(db);
  for (const sql of [STAGE1, STAGE2, STAGE3]) assert.ok((await migrate(db, sql)).ok);
  const early = await migrate(db, STAGE4A);
  assert.equal(early.ok, false);
  assert.match(early.error, /Stage 1, 2, 3 and 3b/);
  assert.ok((await migrate(db, STAGE3B)).ok);
  assert.ok((await migrate(db, STAGE4A)).ok);
  assert.ok((await migrate(db, STAGE4A)).ok, 're-run');
  assert.equal(await legacySnapshot(db), before, 'existing rows unchanged');

  await db.query('set role owner_role');
  await db.exec(STAGE4A_ROLLBACK);
  await db.query('reset role');
  assert.equal((await db.query(`select to_regprocedure('public.playlist_add_video(text,text,text)') as f`)).rows[0].f, null);
  assert.ok((await migrate(db, STAGE4A)).ok, 're-applies after rollback');
  await db.close();
});

test('YouTube videos in rooms', async (t) => {
  const db = await createMigratedDb();
  const room = await createRoom(db, 'A');
  await joinRoom(db, 'B', room.code);

  await t.test('host plays a YouTube video for everyone; the room follows', async () => {
    const pb = (await as(db, 'A', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, YT, true, 0])).rows[0];
    assert.equal(pb.movie_id, YT);
    assert.equal((await db.query('select current_movie_id from public.rooms where id = $1', [room.id])).rows[0].current_movie_id, YT);
    assert.equal((await as(db, 'B', 'select movie_id from public.room_playback')).rows[0].movie_id, YT, 'guests read it');
  });

  await t.test('pause and seek are shared like any movie; switching back to a catalog movie works', async () => {
    const paused = (await as(db, 'A', 'select * from public.set_playback($1, $2, $3, $4)', [room.code, YT, false, 42.5])).rows[0];
    assert.deepEqual([paused.is_playing, paused.position_sec], [false, 42.5]);
    await as(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, 'movie-1', true, 0]);
    assert.equal((await as(db, 'B', 'select movie_id from public.room_playback')).rows[0].movie_id, 'movie-1');
  });

  await t.test('invalid movie ids are refused by the database', async () => {
    for (const bad of ['yt:short', 'yt:aqz-KE-bpKQX', 'yt:<script>x', 'https://youtube.com/watch?v=aqz-KE-bpKQ', 'Movie-1', '<iframe>']) {
      const err = await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, bad, true, 0]);
      assert.match(err ?? 'accepted', /movie_id_format|Invalid movie/, `refused: ${bad}`);
    }
  });

  await t.test('host queues a YouTube video with a title; titles are cleaned', async () => {
    const item = (await as(db, 'A', 'select * from public.playlist_add_video($1, $2, $3)',
      // (NUL cannot be stored in PostgreSQL text at all; other control characters are removed)
      [room.code, YT, '  Big Buck\u0007 Bunny\u001b\n 4K  '])).rows[0];
    assert.equal(item.movie_id, YT);
    assert.equal(item.title, 'Big Buck Bunny 4K');
    const seen = (await as(db, 'B', 'select movie_id, title from public.room_playlist_items')).rows;
    assert.deepEqual(seen, [{ movie_id: YT, title: 'Big Buck Bunny 4K' }], 'guests see the same title');

    const long = (await as(db, 'A', 'select * from public.playlist_add_video($1, $2, $3)', [room.code, 'yt:dQw4w9WgXcQ', 'x'.repeat(500)])).rows[0];
    assert.equal(long.title.length, 200, 'long titles are cut to 200 characters');
    const empty = (await as(db, 'A', 'select * from public.playlist_add_video($1, $2, $3)', [room.code, 'yt:M7lc1UVf-VE', '   '])).rows[0];
    assert.equal(empty.title, null, 'blank title stored as none');
  });

  await t.test('queue rules still apply: duplicates, bad ids, reorder and remove', async () => {
    assert.match(await errorOf(db, 'A', 'select public.playlist_add_video($1, $2, $3)', [room.code, YT, 'again']), /already in the queue/);
    assert.match(await errorOf(db, 'A', 'select public.playlist_add_video($1, $2, $3)', [room.code, 'yt:bad', 'x']), /not a valid video/);
    await as(db, 'A', 'select public.playlist_add($1, $2)', [room.code, 'movie-3']); // catalog movies still work
    const items = (await as(db, 'A', 'select id, movie_id from public.room_playlist_items order by position')).rows;
    await as(db, 'A', 'select public.playlist_move($1, $2, $3)', [room.code, items.at(-1).id, -1]);
    await as(db, 'A', 'select public.playlist_remove($1, $2)', [room.code, items[0].id]);
    const after = (await as(db, 'A', 'select movie_id from public.room_playlist_items order by position')).rows.map((r) => r.movie_id);
    assert.deepEqual(after, ['yt:dQw4w9WgXcQ', 'movie-3', 'yt:M7lc1UVf-VE']);
  });

  await t.test('other unique conflicts are not reported as "already in the queue"', async () => {
    // Simulate an unexpected unique conflict: only one item titled "conflict" per room
    await db.query(`create unique index stage4a_test_one_per_user on public.room_playlist_items (room_id) where title = 'conflict'`);
    try {
      await as(db, 'A', 'select public.playlist_add_video($1, $2, $3)', [room.code, 'yt:9bZkp7q19f0', 'conflict']);
      const err = await errorOf(db, 'A', 'select public.playlist_add_video($1, $2, $3)', [room.code, 'yt:jNQXAC9IVRw', 'conflict']);
      assert.match(err ?? 'accepted', /queue changed at the same moment/);
      assert.match(await errorOf(db, 'A', 'select public.playlist_add_video($1, $2, $3)', [room.code, 'yt:9bZkp7q19f0', 'x']), /already in the queue/,
        'a real duplicate is still reported as a duplicate');
    } finally {
      await db.query('drop index public.stage4a_test_one_per_user');
    }
  });

  await t.test('guests cannot add, play or change YouTube videos', async () => {
    assert.match(await errorOf(db, 'B', 'select public.playlist_add_video($1, $2, $3)', [room.code, 'yt:jNQXAC9IVRw', 'x']), /Only the host/);
    assert.match(await errorOf(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, YT, true, 0]), /Only the host/);
    assert.match(await errorOf(db, 'B', 'update public.room_playlist_items set title = $1', ['hacked']), /permission denied/);
    assert.match(await errorOf(db, 'C', 'select public.playlist_add_video($1, $2, $3)', [room.code, YT, 'x']), /not a member/);
    assert.match(await errorOf(db, null, 'select public.playlist_add_video($1, $2, $3)', [room.code, YT, 'x']), /permission denied/);
  });

  await t.test('after host transfer during YouTube playback the new host controls it', async () => {
    await as(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, YT, true, 10]);
    await as(db, 'A', 'select public.transfer_host($1, $2)', [room.code, USERS.B]);
    assert.equal((await as(db, 'B', 'select movie_id, is_playing from public.room_playback')).rows[0].movie_id, YT, 'still the same video');
    await as(db, 'B', 'select public.set_playback($1, $2, $3, $4)', [room.code, YT, false, 20]);
    assert.match(await errorOf(db, 'A', 'select public.set_playback($1, $2, $3, $4)', [room.code, YT, true, 0]), /Only the host/);
    assert.match(await errorOf(db, 'A', 'select public.playlist_add_video($1, $2, $3)', [room.code, 'yt:jNQXAC9IVRw', 'x']), /Only the host/);
  });

  await t.test('automatic transfer during YouTube playback keeps the video', async () => {
    const other = await createRoom(db, 'C', 'Auto');
    await joinRoom(db, 'D', other.code);
    for (const who of ['C', 'D']) await renew(db, who, other.code);
    await as(db, 'C', 'select public.set_playback($1, $2, $3, $4)', [other.code, YT, true, 5]);
    await db.query(`update public.room_connection_leases set renewed_at = now() - interval '30 seconds' where room_id = $1 and user_id = $2`, [other.id, USERS.C]);
    await as(db, 'D', 'select public.auto_transfer_host($1)', [other.code]);
    await as(db, 'D', 'select public.set_playback($1, $2, $3, $4)', [other.code, YT, false, 7]);
    assert.equal((await as(db, 'D', 'select movie_id, position_sec from public.room_playback')).rows[0].position_sec, 7);
  });

  await db.close();
});
