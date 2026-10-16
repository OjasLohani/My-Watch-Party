// Real-browser regression test for host playback control.
//
// Mounts the real VideoPlayer as HOST and GUEST on one page
// (tests/browser/host-sync.html) with an in-page fake server instead of
// Supabase, drives it with Chrome, and checks the host's actual
// <video> element after every step.
//
// Run with:  npm run test:browser
// Needs Google Chrome installed (set CHROME_PATH if it is not found) and
// an internet connection (it plays the real catalog video).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && existsSync(p));
}

let server;
let browser;
let page;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** State of a player's real <video> element */
const video = (who) =>
  page.evaluate((id) => {
    const v = document.querySelector(`#${id} video`);
    const button = document.querySelector(`#${id} button[aria-label="Play"], #${id} button[aria-label="Pause"]`);
    return { paused: v.paused, time: v.currentTime, seeking: v.seeking, button: button?.getAttribute('aria-label') };
  }, who);

const lastPublished = () => page.evaluate(() => window.harness.published.at(-1));
const seekEvents = () => page.evaluate(() => window.hostSeekEvents);

/** Waits until the host's video is really advancing */
async function waitUntilHostPlays(timeout = 30000) {
  await page.waitForFunction(() => {
    const v = document.querySelector('#host video');
    const last = window.lastHostTime ?? -1;
    window.lastHostTime = v.currentTime;
    return !v.paused && !v.seeking && v.currentTime > last && last >= 0;
  }, { timeout, polling: 500 });
}

async function seekHostTo(fraction, { drag = false } = {}) {
  await page.hover('#host video');
  const box = await (await page.$('#host input[aria-label="Seek"]')).boundingBox();
  const y = box.y + box.height / 2;
  if (drag) {
    await page.mouse.move(box.x + box.width * 0.1, y);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + box.width * (0.1 + ((fraction - 0.1) * i) / 15), y);
    await page.mouse.up();
  } else {
    await page.mouse.click(box.x + box.width * fraction, y);
  }
}

before(async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'Google Chrome not found; set CHROME_PATH');
  server = await createServer({ root: projectRoot, logLevel: 'error', server: { port: 5199 } });
  await server.listen();
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), 'watch-party-chrome-')), // never the user's profile
    args: ['--no-first-run', '--mute-audio'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/host-sync.html`);
  await page.evaluate(() => {
    window.hostSeekEvents = 0;
    document.querySelector('#host video').addEventListener('seeking', () => window.hostSeekEvents++);
  });
  await page.waitForFunction(() => document.querySelector('#host video').readyState >= 1, { timeout: 60000 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('host: play → seek while playing → keeps playing (the reported bug)', async () => {
  await page.click('#host button[aria-label="Play video"]');
  await waitUntilHostPlays();
  assert.equal((await lastPublished()).isPlaying, true);

  await seekHostTo(0.4);
  await waitUntilHostPlays();
  const host = await video('host');
  assert.equal(host.paused, false, 'host must keep playing after seeking');
  assert.equal(host.button, 'Pause', 'button shows the host is playing');
  assert.ok(host.time > 200, `host moved to the seek target (t=${host.time})`);
  assert.equal((await lastPublished()).isPlaying, true, 'guests were told: playing');

  await wait(2500); // guest catches up
  const guest = await video('guest');
  assert.equal(guest.paused, false, 'guest plays too');
  assert.ok(Math.abs(guest.time - (await video('host')).time) < 1.5, 'guest is next to the host');
});

test('host: dragging the progress bar seeks once, on release', async () => {
  const before = await seekEvents();
  await seekHostTo(0.6, { drag: true });
  await waitUntilHostPlays();
  assert.equal((await seekEvents()) - before, 1, 'one seek for the whole drag');
  assert.equal((await video('host')).paused, false);
});

test('host: pause → seek while paused → stays paused (guest too)', async () => {
  await page.click('#host button[aria-label="Pause"]');
  await wait(500);
  assert.equal((await video('host')).paused, true);

  await seekHostTo(0.3);
  await wait(4000);
  const host = await video('host');
  assert.equal(host.paused, true, 'seeking while paused stays paused');
  assert.equal(host.button, 'Play');
  const published = await lastPublished();
  assert.equal(published.isPlaying, false);
  assert.ok(Math.abs(published.position - host.time) < 0.5, 'guests got the new position');
  await wait(2000);
  assert.equal((await video('guest')).paused, true, 'guest stays paused');
});

test('host: clicking Play always resumes the local video', async () => {
  await page.click('#host button[aria-label="Play"]');
  await waitUntilHostPlays();
  assert.equal((await video('host')).paused, false);
  assert.equal((await lastPublished()).isPlaying, true);
  await wait(2500);
  assert.equal((await video('guest')).paused, false, 'guest follows');
});

test('host: player reloads mid-film → resumes the shared state, not 0:00', async () => {
  const beforeReload = (await video('host')).time;
  await page.evaluate(() => document.querySelector('#host video').load()); // same as a source switch / remount
  await waitUntilHostPlays(45000);
  const host = await video('host');
  assert.ok(host.time > beforeReload - 1, `resumed near ${beforeReload.toFixed(1)}s, got ${host.time.toFixed(1)}s`);
  assert.equal((await lastPublished()).isPlaying, true, 'guests were not told to pause');
});

test('host: pause from outside the app (media keys) is followed by guests', async () => {
  await page.evaluate(() => document.querySelector('#host video').pause());
  await wait(2500); // longer than the 1 s safety-net interval
  const host = await video('host');
  assert.equal(host.paused, true, 'not fought back into playing');
  assert.equal(host.button, 'Play');
  assert.equal((await lastPublished()).isPlaying, false);
  await wait(1500);
  assert.equal((await video('guest')).paused, true);
});
