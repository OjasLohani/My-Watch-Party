// Real-browser test of synchronized YouTube playback.
//
// Mounts the real VideoPlayer as HOST and GUEST on the harness page
// (tests/browser/host-sync.html?yt=<id>) with the in-page fake server
// instead of Supabase. Each player runs the official YouTube IFrame
// player; the test reads each player's state through its adapter.
//
// Needs Google Chrome and an internet connection (plays a real YouTube
// video: Big Buck Bunny, uploaded by the Blender Foundation).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, launchChrome, wait } from './browserEnv.mjs';

const VIDEO = 'aqz-KE-bpKQ';
const MISSING = 'aaaaaaaaaaa'; // well-formed ID with no video behind it

let server;
let baseUrl;
let browser;
let page;

const yt = (p, id) => p.evaluate((playerId) => window.ytState(playerId), id);
const both = () => page.evaluate(() => ({ host: window.ytState('host'), guest: window.ytState('guest') }));
const button = (p, id) =>
  p.evaluate((playerId) =>
    document.querySelector(`#${playerId} button[aria-label="Play"], #${playerId} button[aria-label="Pause"]`)
      ?.getAttribute('aria-label'), id);

async function clickPlayPause(p, id) {
  await p.hover(`#${id} [role="region"]`);
  await p.click(`#${id} button[aria-label="Play"], #${id} button[aria-label="Pause"]`);
}

async function seekTo(p, id, fraction) {
  await p.hover(`#${id} [role="region"]`);
  const box = await (await p.$(`#${id} input[aria-label="Seek"]`)).boundingBox();
  await p.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

/** Waits until a player's YouTube video is really advancing */
async function waitUntilAdvancing(p, id, timeout = 45000) {
  await p.waitForFunction((playerId) => {
    const s = window.ytState(playerId);
    window.__ytLast ??= {};
    const last = window.__ytLast[playerId] ?? -1;
    if (s) window.__ytLast[playerId] = s.time;
    return Boolean(s) && !s.paused && !s.seeking && s.time > last && last >= 0;
  }, { timeout, polling: 500 }, id);
}

/** Largest host–guest gap (seconds) over a few samples while playing */
async function measureDrift(samples = 6) {
  let worst = 0;
  for (let i = 0; i < samples; i++) {
    const s = await both();
    worst = Math.max(worst, Math.abs(s.host.time - s.guest.time));
    await wait(500);
  }
  return worst;
}

before(async () => {
  ({ server, baseUrl } = await startDevServer());
  browser = await launchChrome();
  page = await browser.newPage();
  await page.goto(`${baseUrl}tests/browser/host-sync.html?yt=${VIDEO}`, { waitUntil: 'domcontentloaded' });
  // Both YouTube players loaded the video
  await page.waitForFunction(() => window.ytState('host')?.readyState >= 2 && window.ytState('guest')?.readyState >= 2,
    { timeout: 45000, polling: 500 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('YouTube: the official player is used, with no YouTube controls for guests', async () => {
  const frames = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src));
  assert.equal(frames.length, 2);
  for (const src of frames.map((href) => new URL(href))) {
    assert.equal(src.origin, 'https://www.youtube-nocookie.com');
    assert.match(src.pathname, new RegExp(`^/embed/${VIDEO}$`));
    assert.equal(src.searchParams.get('controls'), '0');
  }
  // The guest's play button is locked (only the host controls playback)
  const guestLocked = await page.evaluate(() =>
    document.querySelector('#guest button[aria-label="Play"]')?.disabled);
  assert.equal(guestLocked, true);
});

test('YouTube: host plays → guest plays in sync', async () => {
  await clickPlayPause(page, 'host', 'Play');
  await waitUntilAdvancing(page, 'host');
  await waitUntilAdvancing(page, 'guest');
  await wait(2000); // let the first correction settle
  const drift = await measureDrift();
  console.log(`  host–guest gap while playing: ${(drift * 1000).toFixed(0)} ms`);
  assert.ok(drift < 1.5, `guest within 1.5 s of host (was ${drift.toFixed(2)} s)`);
});

test('YouTube: host pauses → guest pauses at the same spot', async () => {
  await clickPlayPause(page, 'host');
  await page.waitForFunction(() => window.ytState('guest').paused, { timeout: 10000 });
  await wait(1500);
  const s = await both();
  assert.equal(s.host.paused, true);
  assert.ok(Math.abs(s.host.time - s.guest.time) < 0.75, `paused positions match (${s.host.time} vs ${s.guest.time})`);
});

test('YouTube: host seeks while paused → guest follows and stays paused', async () => {
  await seekTo(page, 'host', 0.5);
  await page.waitForFunction(() => Math.abs(window.ytState('guest').time - window.ytState('host').time) < 0.75
    && window.ytState('host').time > 200, { timeout: 20000, polling: 300 });
  const s = await both();
  assert.equal(s.host.paused, true, 'host stays paused');
  assert.equal(s.guest.paused, true, 'guest stays paused');
});

test('YouTube: host seeks while playing → keeps playing, guest follows', async () => {
  await clickPlayPause(page, 'host');
  await waitUntilAdvancing(page, 'host');
  await seekTo(page, 'host', 0.2);
  await page.waitForFunction(() => {
    const h = window.ytState('host');
    const g = window.ytState('guest');
    return !h.paused && !g.paused && h.time < 200 && Math.abs(h.time - g.time) < 1.5;
  }, { timeout: 30000, polling: 500 });
  assert.equal(await button(page, 'host'), 'Pause', 'host shows playing');
});

test('YouTube: a guest that missed updates catches up after reconnecting', async () => {
  await page.evaluate(() => window.harness.setConnected('guest', false));
  await seekTo(page, 'host', 0.6); // guest misses this
  await wait(3000);
  const apart = await both();
  assert.ok(Math.abs(apart.host.time - apart.guest.time) > 30, 'guest fell behind while disconnected');
  await page.evaluate(() => window.harness.setConnected('guest', true));
  await page.waitForFunction(() => Math.abs(window.ytState('guest').time - window.ytState('host').time) < 1.5,
    { timeout: 20000, polling: 500 });
});

test('YouTube: a late joiner starts at the shared position', async () => {
  const late = await browser.newPage();
  try {
    await late.goto(`${baseUrl}tests/browser/host-sync.html?yt=${VIDEO}&player=late&host=host`, { waitUntil: 'domcontentloaded' });
    await late.waitForFunction(() => window.harness?.receive && window.ytState('late')?.readyState >= 2,
      { timeout: 45000, polling: 500 });
    const snapshot = await page.evaluate(() => window.harness.server());
    assert.equal(snapshot.movieId, `yt:${'aqz-KE-bpKQ'}`);
    await late.evaluate((s) => window.harness.receive(s), snapshot);
    await waitUntilAdvancing(late, 'late');
    const [hostTime, lateTime] = await Promise.all([yt(page, 'host'), yt(late, 'late')]).then((r) => r.map((s) => s.time));
    assert.ok(Math.abs(hostTime - lateTime) < 2, `late joiner within 2 s (${hostTime.toFixed(1)} vs ${lateTime.toFixed(1)})`);
  } finally {
    await late.close();
  }
});

test('YouTube: after host transfer the new host controls the video', async () => {
  await page.evaluate(() => window.harness.transferHostTo('guest'));
  await wait(1000);
  // The new host keeps playing (nothing jumps) and can pause for everyone
  assert.equal((await yt(page, 'guest')).paused, false, 'still playing after the transfer');
  await clickPlayPause(page, 'guest');
  await page.waitForFunction(() => window.ytState('host').paused && window.ytState('guest').paused, { timeout: 10000 });
  const last = await page.evaluate(() => window.harness.published.at(-1));
  assert.equal(last.from, 'guest', 'published by the new host');
  // The old host's controls are now locked
  const oldHostLocked = await page.evaluate(() => document.querySelector('#host button[aria-label="Play"]')?.disabled);
  assert.equal(oldHostLocked, true);
});

test('YouTube: an unavailable video shows a clear message', async () => {
  const bad = await browser.newPage();
  try {
    await bad.goto(`${baseUrl}tests/browser/host-sync.html?yt=${MISSING}`, { waitUntil: 'domcontentloaded' });
    await bad.waitForFunction(() => /Video unavailable/.test(document.querySelector('#host')?.textContent ?? ''),
      { timeout: 45000, polling: 500 });
    const text = await bad.evaluate(() => document.querySelector('#host').textContent);
    assert.match(text, /removed or is private|not valid|does not allow|cannot be played/);
    assert.match(text, /The host can choose another video/);
    assert.ok((await yt(bad, 'host')).error !== null, 'YouTube error code recorded');
  } finally {
    await bad.close();
  }
});
