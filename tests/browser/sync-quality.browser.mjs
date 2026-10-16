// Real-browser tests: host transfer during playback, reconnection, and
// sync quality with 10 people in a room (1 host + 9 guests).
//
// The page uses an in-page fake server with an 80 ms delay instead of
// Supabase, so these numbers measure the PLAYERS' synchronisation.
// Real network delay is measured in the app itself: open the browser
// console in a guest's tab and type  window.watchPartySync
//
// Run with: npm run test:browser
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { percentile } from '../../src/lib/syncStats.ts';
import {
  startDevServer, launchChrome, wait, videoState, waitUntilPlaying, clickProgressBar, ensureLocalTestVideo,
} from './browserEnv.mjs';

let server;
let baseUrl;
let browser;

before(async () => {
  ({ server, baseUrl } = await startDevServer());
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openRoom(guests, src) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1200 });
  await page.goto(`${baseUrl}tests/browser/host-sync.html?guests=${guests}${src ? `&src=${encodeURIComponent(src)}` : ''}`);
  await page.waitForFunction(() => document.querySelector('#host video').readyState >= 1, { timeout: 60000 });
  return page;
}

test('host transfer during playback: new host keeps playing and takes control', async () => {
  const page = await openRoom(1);
  await page.click('#host button[aria-label="Play video"]');
  await waitUntilPlaying(page, 'host');
  await waitUntilPlaying(page, 'guest');

  await page.evaluate(() => window.harness.transferHostTo('guest'));
  await wait(2000);
  const newHost = await videoState(page, 'guest');
  assert.equal(newHost.paused, false, 'new host keeps playing');
  assert.equal(newHost.button, 'Pause', 'new host sees the playing state');
  assert.equal(newHost.buttonDisabled, false, 'new host can use the controls');
  assert.equal((await videoState(page, 'host')).buttonDisabled, true, 'old host is locked');

  // The new host pauses: the old host (now a guest) follows
  await page.click('#guest button[aria-label="Pause"]');
  await wait(2500);
  assert.equal((await videoState(page, 'guest')).paused, true);
  assert.equal((await videoState(page, 'host')).paused, true, 'old host follows the new host');
  const last = await page.evaluate(() => window.harness.published.at(-1));
  assert.equal(last.from, 'guest');
  await page.close();
});

test('reconnection: a guest that missed updates catches up within seconds', async () => {
  // Local video: the test seeks far ahead and must not depend on the network
  const page = await openRoom(1, await ensureLocalTestVideo());
  await page.click('#host button[aria-label="Play video"]');
  await waitUntilPlaying(page, 'guest');

  await page.evaluate(() => window.harness.setConnected('guest', false));
  await clickProgressBar(page, 'host', 0.2); // ~130 s; the guest does not hear about this
  await waitUntilPlaying(page, 'host');
  await wait(1500);
  const apart = Math.abs((await videoState(page, 'host')).time - (await videoState(page, 'guest')).time);
  assert.ok(apart > 100, `guest is out of date while disconnected (${apart.toFixed(1)} s apart)`);

  await page.evaluate(() => window.harness.setConnected('guest', true)); // like a resync on reconnect
  await page.waitForFunction(() => {
    const h = document.querySelector('#host video');
    const g = document.querySelector('#guest video');
    return !g.paused && !g.seeking && Math.abs(h.currentTime - g.currentTime) < 0.5;
  }, { timeout: 15000, polling: 250 });
  await page.close();
});

test('10 people in a room (separate browser contexts): drift and command latency', async () => {
  // Each person gets an isolated browser context (own connections, like a
  // separate browser). This script plays the server: it stamps and
  // versions the host's changes and sends them to everyone after 80 ms.
  const src = await ensureLocalTestVideo();
  const ids = ['host', ...Array.from({ length: 9 }, (_, i) => `guest${i + 1}`)];
  const pages = new Map();
  let version = 0;
  const relay = (from, state) => {
    setTimeout(async () => {
      const snapshot = {
        movieId: 'movie-1', isPlaying: state.isPlaying, position: state.position, rate: 1,
        updatedAtMs: Date.now(), version: ++version, updatedBy: from,
      };
      await Promise.all([...pages.values()].map((p) => p.evaluate((snap) => window.harness.receive(snap), snapshot)));
    }, 80);
  };

  const contexts = [];
  for (const id of ids) {
    const context = await browser.createBrowserContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.setViewport({ width: 900, height: 700 });
    await page.exposeFunction('relayPublish', relay);
    await page.goto(`${baseUrl}tests/browser/host-sync.html?player=${id}&host=host&src=${encodeURIComponent(src)}${process.env.SYNC_NO_LEAD ? '&nolead=1' : ''}`);
    pages.set(id, page);
  }
  const guests = ids.slice(1);
  for (const id of ids) {
    await pages.get(id).waitForFunction((pid) => document.querySelector(`#${pid} video`).readyState >= 1, { timeout: 90000 }, id);
    await pages.get(id).evaluate((pid) => {
      window.reactions = [];
      const v = document.querySelector(`#${pid} video`);
      for (const ev of ['playing', 'pause']) v.addEventListener(ev, () => window.reactions.push({ ev, at: Date.now() }));
    }, id);
  }

  await pages.get('host').click('#host button[aria-label="Play video"]');
  for (const id of guests) await waitUntilPlaying(pages.get(id), id, 90000);
  await wait(4000); // let everyone converge

  // Steady-state drift: every 500 ms for 20 s. Each page reports its
  // position with a timestamp; positions are projected to one instant.
  const drift = [];
  for (let i = 0; i < 40; i++) {
    const readings = await Promise.all(ids.map((id) => pages.get(id).evaluate((pid) => {
      const v = document.querySelector(`#${pid} video`);
      return { time: v.currentTime, at: Date.now(), playing: !v.paused };
    }, id)));
    const t = Math.max(...readings.map((r) => r.at));
    const at = (r) => r.time + (r.playing ? (t - r.at) / 1000 : 0);
    const host = at(readings[0]);
    for (const r of readings.slice(1)) drift.push(Math.abs(at(r) - host) * 1000);
    await wait(500);
  }
  drift.sort((a, b) => a - b);

  // Command latency: host clicks → each guest's video reacts
  async function commandLatency(selector, event) {
    await Promise.all(guests.map((id) => pages.get(id).evaluate(() => { window.reactions = []; })));
    const t0 = Date.now();
    await pages.get('host').click(selector);
    await wait(4000);
    const results = await Promise.all(guests.map((id) => pages.get(id).evaluate((ev) =>
      window.reactions.find((r) => r.ev === ev)?.at, event)));
    return results.filter(Number.isFinite).map((at) => at - t0);
  }
  const pauseLatency = await commandLatency('#host button[aria-label="Pause"]', 'pause');
  const playLatency = await commandLatency('#host button[aria-label="Play"]', 'playing');
  const all = [...pauseLatency, ...playLatency].sort((a, b) => a - b);

  const report = {
    people: ids.length,
    driftMs: { samples: drift.length, p50: Math.round(percentile(drift, 50)), p95: Math.round(percentile(drift, 95)), max: Math.round(drift.at(-1)) },
    commandLatencyMs: { samples: all.length, p50: Math.round(percentile(all, 50)), p95: Math.round(percentile(all, 95)), max: Math.round(all.at(-1)) },
  };
  console.log('\n  10-person room measurements:', JSON.stringify(report));

  assert.equal(pauseLatency.length, 9, 'every guest paused');
  assert.equal(playLatency.length, 9, 'every guest resumed');
  assert.ok(report.driftMs.p95 <= 500, `drift p95 ${report.driftMs.p95} ms is within the 500 ms target`);
  assert.ok(report.commandLatencyMs.p95 <= 1000, `command latency p95 ${report.commandLatencyMs.p95} ms`);
  for (const context of contexts) await context.close();
});
