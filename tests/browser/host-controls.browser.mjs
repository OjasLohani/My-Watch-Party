// Regression test: the host's "Make Host" button (manual host transfer).
// Host and guest run as separate browser contexts on one fake Supabase
// backend (fakeSupabase.mjs); transfer_host there only accepts the host,
// like the real RPC. Database rules: supabase/tests/*.test.mjs.
//
// Run with: npm run test:browser
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, launchChrome, wait } from './browserEnv.mjs';
import { createFakeSupabase, FAKE_SUPABASE_URL, FAKE_ANON_KEY } from './fakeSupabase.mjs';

let server;
let baseUrl;
let browser;

before(async () => {
  process.env.VITE_SUPABASE_URL = FAKE_SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
  ({ server, baseUrl } = await startDevServer());
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const inRoom = (page) => page.waitForFunction(() => document.body.innerText.includes('Room Participants'), { timeout: 20000 });

/** Joins the fake room by invite link; the first person to ask for it becomes host */
async function person(fake, name, { asHost = false, width = 1400, height = 1000 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((n) => {
    localStorage.setItem('watchparty_user_name', n);
    localStorage.setItem('watchparty_user_name_chosen', '1');
  }, name);
  await fake.attach(page);
  if (asHost) {
    const original = fake.state.room.host_id;
    page.on('response', () => {
      const me = fake.callsTo('signup')[0]?.userId;
      if (me && fake.state.room.host_id === original) {
        fake.state.room.host_id = me;
        fake.state.members = [];
      }
    });
  }
  await page.goto(`${baseUrl}?room=${fake.state.room.code}`);
  await inRoom(page);
  return { context, page, id: fake.callsTo('join_room').at(-1).userId };
}

/** Host "Ana" and guest "Ben" in one room; the host's page shows Ben */
async function hostAndGuest(options = {}) {
  const fake = createFakeSupabase();
  const host = await person(fake, 'Ana', { asHost: true, ...options });
  const guest = await person(fake, 'Ben', options);
  // Realtime is not simulated: reload so the host's member list includes Ben
  await host.page.reload();
  await host.page.waitForFunction(() => document.body.innerText.includes('Ben'), { timeout: 20000 });
  return { fake, host, guest };
}

/** "Make Host" buttons on the page: whose row they are in, and whether visible */
const makeHostButtons = (page) => page.$$eval('button[aria-label^="Make Host"]', (buttons) => buttons.map((b) => {
  const box = b.getBoundingClientRect();
  return { label: b.getAttribute('aria-label'), text: b.innerText.trim(), visible: box.width > 0 && box.height > 0, width: box.width, height: box.height };
}));

const openParticipants = async (page) => {
  await page.click('#room-tab-people');
  await wait(200);
};

test('only the host sees "Make Host" beside the guest (tab and strip); guests see none', async () => {
  const { host, guest } = await hostAndGuest();

  // Host: on the strip under the player without opening anything…
  const strip = await makeHostButtons(host.page);
  assert.deepEqual(strip.map((b) => [b.text, b.label, b.visible]), [['Make Host', 'Make Host: transfer hosting to Ben', true]]);

  // …and in the Participants tab, next to Ben only (never next to yourself)
  await openParticipants(host.page);
  const inTab = await host.page.$$eval('#room-tab-panel li', (rows) => rows.map((row) => ({
    text: row.innerText,
    button: row.querySelector('button[aria-label^="Make Host"]')?.innerText.trim() ?? null,
  })));
  assert.equal(inTab.find((r) => r.text.includes('Ana'))?.button, null, 'no button for the host');
  assert.equal(inTab.find((r) => r.text.includes('Ben'))?.button, 'Make Host');

  // Guest: no transfer buttons anywhere
  await openParticipants(guest.page);
  assert.deepEqual(await makeHostButtons(guest.page), []);
  await host.context.close();
  await guest.context.close();
});

test('clicking "Make Host" transfers hosting once; both browsers update, YouTube permission follows', async () => {
  const { fake, host, guest } = await hostAndGuest();
  await openParticipants(host.page);

  // A double click sends one request
  await host.page.$eval('#room-tab-panel button[aria-label^="Make Host"]', (b) => {
    b.click();
    b.click();
  });
  await host.page.waitForFunction(() => !document.querySelector('button[aria-label^="Make Host"]'), { timeout: 10000 });
  assert.equal(fake.callsTo('transfer_host').length, 1, 'one transfer request');
  assert.equal(fake.callsTo('transfer_host')[0].body.p_new_host_id, guest.id);
  assert.equal(fake.state.room.host_id, guest.id, 'server: Ben is host');

  // Ana (old host) is now a guest: no transfer buttons, playback and YouTube locked
  const ana = await host.page.evaluate(() => ({
    tab: document.getElementById('room-tab-panel').innerText,
    play: document.querySelector('[role="region"] button[aria-label="Play"], [role="region"] button[aria-label="Pause"]')?.disabled,
    youtube: document.body.innerText.includes('The host chooses the video'),
  }));
  assert.match(ana.tab, /Ben\s*\n?\s*Host/, 'Ben listed as host');
  assert.equal(ana.play, true, 'old host cannot control playback');
  assert.equal(ana.youtube, true, 'old host cannot choose YouTube videos');

  // Ben's browser learns it from the server and gains the controls
  await guest.page.waitForFunction(() => document.body.innerText.includes('Paste a link, everyone watches in sync'), { timeout: 15000 });
  const ben = await guest.page.evaluate(() => ({
    play: document.querySelector('[role="region"] button[aria-label="Play"], [role="region"] button[aria-label="Pause"]')?.disabled,
  }));
  assert.equal(ben.play, false, 'new host controls playback');
  await openParticipants(guest.page);
  assert.deepEqual((await makeHostButtons(guest.page)).map((b) => b.label),
    ['Make Host: transfer hosting to Ana', 'Make Host: transfer hosting to Ana'], 'new host can hand it back (tab + strip)');
  await host.context.close();
  await guest.context.close();
});

test('phones: "Make Host" keeps its label and a comfortable size', async () => {
  const { host, guest } = await hostAndGuest({ width: 390, height: 844 });
  await openParticipants(host.page);
  const buttons = await makeHostButtons(host.page);
  assert.equal(buttons.length, 2, 'tab and strip');
  for (const b of buttons) {
    assert.equal(b.text, 'Make Host', 'label visible on phones');
    assert.ok(b.visible && b.height >= 28 && b.width >= 80, `big enough (${b.width}×${b.height})`);
  }
  assert.equal(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no sideways scrolling');
  await host.context.close();
  await guest.context.close();
});
