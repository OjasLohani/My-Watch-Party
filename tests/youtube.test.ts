import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYouTubeLink,
  resolveMovie,
  youTubeIdFromMovieId,
  youTubeMovie,
  youTubeMovieId,
} from '../src/lib/youtube.ts';
import { decideYouTubeCorrection, YOUTUBE_SEEK_MS, YOUTUBE_PAUSED_SEEK_MS } from '../src/lib/playbackService.ts';
import type { Movie } from '../src/types/index.ts';

const ID = 'aqz-KE-bpKQ';

test('accepts the supported link formats', () => {
  const valid = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?list=PL123&v=${ID}&index=2`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}/`,
    `youtu.be/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ];
  for (const link of valid) assert.deepEqual(parseYouTubeLink(link), { ok: true, videoId: ID }, link);
});

test('rejects invalid links with a clear message', () => {
  const invalid: [string, RegExp][] = [
    ['', /Paste a YouTube link/],
    ['not a link', /does not look like a YouTube link|does not look like a link/],
    [`https://vimeo.com/123`, /Only YouTube links/],
    [`https://youtube.com.evil.example/watch?v=${ID}`, /Only YouTube links/],
    [`https://evil.example/watch?v=${ID}`, /Only YouTube links/],
    [`https://www.youtube.com/watch?list=PL123`, /playlist link/],
    [`https://www.youtube.com/playlist?list=PL123`, /playlist link/],
    [`https://www.youtube.com/@BlenderOfficial`, /single video/],
    [`https://www.youtube.com/watch?v=short`, /no valid video ID/],
    [`https://www.youtube.com/watch?v=${ID}X`, /no valid video ID/],
    [`https://youtu.be/bad$chars!!`, /no valid video ID/],
    [`javascript:alert(1)`, /Only YouTube links/],
    [`<iframe src="https://www.youtube.com/embed/${ID}"></iframe>`, /not embed code/],
    [`https://www.youtube.com/embed/${ID}`, /single video/],
    [`ftp://youtube.com/watch?v=${ID}`, /Only YouTube links/],
  ];
  for (const [link, message] of invalid) {
    const result = parseYouTubeLink(link);
    assert.equal(result.ok, false, link);
    if (!result.ok) assert.match(result.error, message, link);
  }
});

test('shared movie ids for YouTube videos', () => {
  assert.equal(youTubeMovieId(ID), `yt:${ID}`);
  assert.equal(youTubeIdFromMovieId(`yt:${ID}`), ID);
  assert.equal(youTubeIdFromMovieId('movie-1'), null);
  assert.equal(youTubeIdFromMovieId('yt:<script>'), null, 'invalid ids are never used');
  assert.equal(youTubeIdFromMovieId(`yt:${ID}extra`), null);
});

test('resolving movies: catalog first, YouTube videos built from the id only', () => {
  const catalog = [{ id: 'movie-1', title: 'Tears of Steel' } as Movie];
  assert.equal(resolveMovie(catalog, 'movie-1')?.title, 'Tears of Steel');
  const yt = resolveMovie(catalog, `yt:${ID}`, { [`yt:${ID}`]: 'Big Buck Bunny' });
  assert.equal(yt?.source, 'youtube');
  assert.equal(yt?.youtubeId, ID);
  assert.equal(yt?.title, 'Big Buck Bunny');
  assert.equal(yt?.posterUrl, `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  assert.equal(resolveMovie(catalog, 'yt:bad'), undefined);
  assert.equal(resolveMovie(catalog, 'movie-404'), undefined);
  assert.equal(youTubeMovie(ID).title, 'YouTube video', 'default title');
});

test('YouTube drift correction: only seeks (YouTube has fixed speeds)', () => {
  assert.deepEqual(decideYouTubeCorrection(YOUTUBE_SEEK_MS - 1, true), { kind: 'none' });
  assert.deepEqual(decideYouTubeCorrection(-(YOUTUBE_SEEK_MS + 1), true), { kind: 'seek' });
  assert.deepEqual(decideYouTubeCorrection(YOUTUBE_PAUSED_SEEK_MS - 1, false), { kind: 'none' });
  assert.deepEqual(decideYouTubeCorrection(YOUTUBE_PAUSED_SEEK_MS + 1, false), { kind: 'seek' });
  for (const drift of [-900, -300, 0, 300, 900]) {
    assert.notEqual(decideYouTubeCorrection(drift, true).kind, 'rate', 'never a speed change');
  }
});
