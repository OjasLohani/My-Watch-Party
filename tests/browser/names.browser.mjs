// Real-browser tests of guest name selection in the actual app UI.
//
// The app runs in demo mode (Supabase settings blanked for this test
// server only), so every flow is exercised without a Supabase project.
// Server-side rules for names are covered by supabase/tests/names.test.mjs.
//
// Run with: npm run test:browser
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, launchChrome, wait } from './browserEnv.mjs';

let server;
let baseUrl;
let browser;

before(async () => {
  // Environment variables set here win over .env.local (Vite rule)
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_ANON_KEY = '';
  ({ server, baseUrl } = await startDevServer());
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** A fresh visitor: separate browser context = empty storage */
async function newVisitor() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  return { context, page };
}

const nameDialog = (page) => page.$('[role="dialog"][aria-labelledby="name-modal-title"]');
const navbarText = (page) => page.$eval('nav', (el) => el.innerText);
const membersText = (page) => page.evaluate(() =>
  [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('Room Participants'))?.closest('div.rounded-2xl')?.innerText ?? '');

async function submitName(page, name) {
  await page.waitForSelector('#display-name-input');
  await page.$eval('#display-name-input', (el) => {
    // set the value the way React expects
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('#display-name-input', name);
  await page.click('[aria-labelledby="name-modal-title"] button[type="submit"]');
}

async function waitForRoom(page) {
  await page.waitForFunction(() => document.body.innerText.includes('Room Participants'), { timeout: 20000 });
}

test('invite link, first visit: name is asked before joining, then used everywhere', async () => {
  const { context, page } = await newVisitor();
  await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
  await page.waitForSelector('#display-name-input', { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Room Participants')), false, 'not joined yet');

  await submitName(page, '   Ann    Lee  ');
  await waitForRoom(page);
  assert.equal(await nameDialog(page), null, 'dialog closed');
  assert.match(await navbarText(page), /Ann Lee/, 'navbar uses the cleaned name');
  assert.match(await membersText(page), /Ann Lee\s*\(You\)/, 'member list');

  // Chat shows the name
  await page.type('input[aria-label="Chat message"]', 'hello everyone');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="log"] p')].some((p) => p.textContent === 'hello everyone'));
  const chat = await page.$eval('[role="log"]', (el) => el.innerText);
  assert.match(chat, /Ann Lee/);

  // Remembered: a reload joins straight away, no dialog
  await page.reload();
  await waitForRoom(page);
  await wait(500);
  assert.equal(await nameDialog(page), null, 'no name dialog on return');
  assert.match(await navbarText(page), /Ann Lee/);
  await context.close();
});

test('name can be edited later and updates the member list, navbar and own chat messages', async () => {
  const { context, page } = await newVisitor();
  await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
  await submitName(page, 'Ann');
  await waitForRoom(page);
  await page.type('input[aria-label="Chat message"]', 'first message');
  await page.keyboard.press('Enter');

  await page.click('button[aria-label="Change your name"]');
  await page.waitForSelector('#display-name-input');
  assert.equal(await page.$eval('#display-name-input', (el) => el.value), 'Ann', 'pre-filled with the current name');
  await submitName(page, 'Bea');
  await page.waitForFunction(() => document.querySelector('nav').innerText.includes('Bea'));
  assert.match(await membersText(page), /Bea\s*\(You\)/);
  const chat = await page.$eval('[role="log"]', (el) => el.innerText);
  // The message bubble's author line shows the new name (system notices
  // like "Ann connected" describe a past event and keep their text)
  assert.match(chat, /Bea\s+\S+\s+first message/, 'earlier own message shows the new name');
  assert.doesNotMatch(chat, /Ann\s+\S+\s+first message/);
  await context.close();
});

test('invalid names are refused with a message', async () => {
  const { context, page } = await newVisitor();
  await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
  await submitName(page, '    ');
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('Please enter a name'));
  await submitName(page, 'x'.repeat(41));
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('at most 40'));
  assert.notEqual(await nameDialog(page), null, 'still asking');
  await submitName(page, 'Valid Name');
  await waitForRoom(page);
  await context.close();
});

test('names are shown as text: HTML in a name never runs', async () => {
  const { context, page } = await newVisitor();
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const evil = '<img src=x onerror="window.__pwned=1">';
  await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
  await submitName(page, evil);
  await waitForRoom(page);
  await page.type('input[aria-label="Chat message"]', 'test');
  await page.keyboard.press('Enter');
  await wait(800);
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'no script ran');
  assert.deepEqual(dialogs, []);
  assert.ok((await navbarText(page)).includes(evil), 'shown literally');
  assert.equal(await page.$('img[src="x"]'), null, 'no injected image element');
  await context.close();
});

test('Join Room dialog: name is asked before joining', async () => {
  const { context, page } = await newVisitor();
  await page.goto(baseUrl);
  await page.waitForSelector('nav');
  await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes('Join Room')).click());
  await page.waitForSelector('[aria-labelledby="join-modal-title"] input');
  await page.type('[aria-labelledby="join-modal-title"] input', 'FILM-CLUB-404');
  await page.click('[aria-labelledby="join-modal-title"] button[type="submit"]');
  await page.waitForSelector('#display-name-input', { timeout: 15000 });
  await submitName(page, 'Cam');
  await waitForRoom(page);
  assert.match(await membersText(page), /Cam\s*\(You\)/);
  await context.close();
});

test('Create Room: host name starts empty, is required, and is remembered', async () => {
  const { context, page } = await newVisitor();
  await page.goto(baseUrl);
  await page.waitForSelector('nav');
  await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes('Create Room')).click());
  await page.waitForSelector('[aria-labelledby="modal-title"]');
  const hostInput = 'input[placeholder="e.g. Sam"]';
  assert.equal(await page.$eval(hostInput, (el) => el.value), '', 'no sample name pre-filled');
  await page.type(hostInput, '  Dee  ');
  await page.evaluate(() => [...document.querySelectorAll('[aria-labelledby="modal-title"] button[type="submit"]')][0].click());
  await waitForRoom(page);
  assert.match(await navbarText(page), /Dee/);
  const stored = await page.evaluate(() => [localStorage.getItem('watchparty_user_name'), localStorage.getItem('watchparty_user_name_chosen')]);
  assert.deepEqual(stored, ['Dee', '1'], 'remembered for future rooms');
  await context.close();
});
