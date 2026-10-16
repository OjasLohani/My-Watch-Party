// Shared setup for the real-browser tests: a Vite dev server for the test
// pages and a headless Chrome with a throwaway profile (never the
// user's own Chrome profile).
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Google Chrome not found; set CHROME_PATH');
  return found;
}

export async function startDevServer() {
  const server = await createServer({ root: projectRoot, logLevel: 'error', server: { port: 5199, strictPort: false } });
  await server.listen();
  return { server, baseUrl: server.resolvedUrls.local[0] };
}

export function launchChrome() {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), 'watch-party-chrome-')),
    args: ['--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Many players on ONE computer would saturate its connection to the video
 * host (ten real viewers have ten connections). Tests with many players
 * therefore play a local copy of the first ~12 MB (~3 minutes) of
 * Elephants Dream (CC BY 2.5), downloaded once into tests/browser/cache/.
 * Returns the path to use as ?src= on the harness page.
 */
export async function ensureLocalTestVideo() {
  const dir = join(projectRoot, 'tests', 'browser', 'cache');
  const file = join(dir, 'elephants-dream-start.mp4');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const res = await fetch('https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4', {
      headers: { Range: 'bytes=0-12582911', 'User-Agent': 'WatchPartyTests/1.0 (one-time test fixture download)' },
      redirect: 'follow',
    });
    if (res.status !== 206 && res.status !== 200) throw new Error(`Test video download failed: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return '/tests/browser/cache/elephants-dream-start.mp4';
}

/** State of one player's real <video> element on the harness page */
export function videoState(page, id) {
  return page.evaluate((playerId) => {
    const v = document.querySelector(`#${playerId} video`);
    const button = document.querySelector(`#${playerId} button[aria-label="Play"], #${playerId} button[aria-label="Pause"]`);
    return {
      paused: v.paused,
      time: v.currentTime,
      seeking: v.seeking,
      button: button?.getAttribute('aria-label'),
      buttonDisabled: Boolean(button?.disabled),
    };
  }, id);
}

/** Waits until a player's video is really advancing */
export async function waitUntilPlaying(page, id, timeout = 45000) {
  await page.waitForFunction((playerId) => {
    const v = document.querySelector(`#${playerId} video`);
    window.__lastTimes ??= {};
    const last = window.__lastTimes[playerId] ?? -1;
    window.__lastTimes[playerId] = v.currentTime;
    return !v.paused && !v.seeking && v.currentTime > last && last >= 0;
  }, { timeout, polling: 500 }, id);
}

/** Clicks a player's progress bar at `fraction` (0–1) */
export async function clickProgressBar(page, id, fraction) {
  await page.hover(`#${id} video`);
  const box = await (await page.$(`#${id} input[aria-label="Seek"]`)).boundingBox();
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}
