// Production check: builds the app, serves it with the exact headers from
// vercel.json, and confirms in Chrome that the Content Security Policy
// does not block anything the app needs (scripts, styles, images, the
// lazily loaded chunks, the realtime worker, Supabase and video hosts).
//
// The build uses a fake Supabase project URL, so nothing is sent to (or
// created in) your real Supabase project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { build } from 'vite';
import { projectRoot, launchChrome } from './browserEnv.mjs';

const FAKE_SUPABASE = 'https://csp-check.supabase.co';
let outDir;
let server;
let browser;
let baseUrl;

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json',
};

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'watch-party-dist-'));
  process.env.VITE_SUPABASE_URL = FAKE_SUPABASE;
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_csp_check_only';
  await build({ root: projectRoot, logLevel: 'error', build: { outDir, emptyOutDir: true } });

  const config = JSON.parse(readFileSync(join(projectRoot, 'vercel.json'), 'utf8'));
  const headers = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
  // HSTS / upgrade-insecure-requests only make sense on https; the local test server is http
  delete headers['Strict-Transport-Security'];
  headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');

  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    let file = join(outDir, path);
    if (!file.startsWith(outDir) || !existsSync(file) || path === '') file = join(outDir, 'index.html');
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}/`;
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test('production build works under the Content Security Policy', async () => {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI}`));
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Homepage rendered from the production bundle
  await page.waitForSelector('nav');
  assert.ok(await page.$('button[aria-label]'), 'app rendered');

  // Lazily loaded parts: open the Join dialog (its own chunk)
  const opened = await page.evaluate(() => {
    const join = [...document.querySelectorAll('button')].find((b) => /join/i.test(b.textContent ?? ''));
    join?.click();
    return Boolean(join);
  });
  assert.ok(opened, 'join button found');
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });

  // Things the CSP must allow, checked from inside the page
  const checks = await page.evaluate(async (supabaseUrl) => {
    const results = {};
    // Realtime heartbeat worker (blob: URL)
    try {
      const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' })));
      results.worker = await new Promise((resolve) => {
        worker.onmessage = () => resolve('ok');
        worker.onerror = () => resolve('blocked');
        setTimeout(() => resolve('timeout'), 3000);
      });
    } catch (e) {
      results.worker = `error: ${e.message}`;
    }
    // Video hosts: a media element loading metadata
    const loadVideo = (src) => new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => resolve('ok');
      v.onerror = () => resolve(`error ${v.error?.code}`);
      setTimeout(() => resolve('timeout'), 20000);
      v.src = src;
    });
    results.archive = await loadVideo('https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4');
    results.wikimedia = await loadVideo('https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.480p.vp9.webm');
    // Supabase: the request must be ALLOWED by CSP (the fake host then fails DNS)
    try {
      await fetch(`${supabaseUrl}/rest/v1/`, { mode: 'cors' });
      results.supabase = 'reached';
    } catch {
      results.supabase = 'network-error';
    }
    return results;
  }, FAKE_SUPABASE);

  // A disallowed host must be blocked (proves the policy is active)
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return false;
    } catch {
      // The violation event is dispatched shortly after the fetch fails
      await new Promise((resolve) => setTimeout(resolve, 500));
      return window.cspViolations.some((v) => v.includes('example.com'));
    }
  });

  const violations = (await page.evaluate(() => window.cspViolations)).filter((v) => !v.includes('example.com'));
  assert.deepEqual(violations, [], 'no CSP violations');
  assert.equal(checks.worker, 'ok', 'realtime worker allowed');
  assert.equal(checks.archive, 'ok', 'archive.org video allowed');
  assert.equal(checks.wikimedia, 'ok', 'Wikimedia video allowed');
  assert.notEqual(checks.supabase, undefined);
  assert.equal(blocked, true, 'other hosts are blocked by the policy');
  assert.deepEqual(pageErrors.filter((m) => !/Failed to fetch|NetworkError|sign in|csp-check/i.test(m)), []);
  await page.close();
});
