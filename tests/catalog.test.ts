// Offline checks of the movie catalog's video sources. Run with: npm test
// (To check the URLs are actually reachable online: npm run check:videos)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockMovies, mockPlaylist, OPEN_MOVIE_VIDEOS } from '../src/mockData.ts';

test('no catalog video uses the retired Google sample bucket', () => {
  const all = [
    ...mockMovies.flatMap((m) => [m.videoUrl, ...(m.fallbackVideoUrls ?? [])]),
    ...mockPlaylist.map((p) => p.videoUrl),
  ];
  for (const url of all) assert.doesNotMatch(url, /commondatastorage\.googleapis\.com/, url);
});

test('every movie has an https primary source, a backup and a licence credit', () => {
  for (const movie of mockMovies) {
    assert.match(movie.videoUrl, /^https:\/\//, movie.title);
    assert.ok((movie.fallbackVideoUrls ?? []).length >= 1, `${movie.title} has a backup source`);
    for (const url of movie.fallbackVideoUrls ?? []) assert.match(url, /^https:\/\//, movie.title);
    assert.match(movie.videoCredit ?? '', /CC BY/, `${movie.title} credits its licence`);
  }
});

test('primary and backup are on different hosts', () => {
  for (const video of Object.values(OPEN_MOVIE_VIDEOS)) {
    const primaryHost = new URL(video.url).host;
    for (const backup of video.fallbacks) assert.notEqual(new URL(backup).host, primaryHost);
  }
});

test('demo queue entries point at catalog videos', () => {
  const known = new Set(Object.values(OPEN_MOVIE_VIDEOS).map((v) => v.url));
  for (const item of mockPlaylist) assert.ok(known.has(item.videoUrl), item.title);
});
