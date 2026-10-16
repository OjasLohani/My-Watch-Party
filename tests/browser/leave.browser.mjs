// Real-browser tests of the Leave Room flow in the actual app, running in
// "real room" mode against a fake Supabase backend (fakeSupabase.mjs), so
// the leave_room request can succeed, fail or be slow on demand.
// What the real leave_room does in the database (membership, immediate
// host hand-off, rejoining) is covered by supabase/tests/leave.test.mjs.
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

/** A guest with a saved name, joined to the fake room through the invite link */
async function joinedGuest({ asHost = false } = {}) {
  const fake = createFakeSupabase();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('watchparty_user_name', 'Gus');
    localStorage.setItem('watchparty_user_name_chosen', '1');
  });
  await fake.attach(page);
  if (asHost) {
    // The first sign-in becomes host of the fake room
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
  const me = fake.callsTo('join_room')[0].userId;
  return { fake, context, page, me };
}

const inRoom = (page) =>
  page.waitForFunction(() => document.body.innerText.includes('Room Participants'), { timeout: 20000 });
const isInRoom = (page) => page.evaluate(() => document.body.innerText.includes('Room Participants'));
const leaveDialog = (page) => page.$('[role="alertdialog"]');

async function openLeaveDialog(page) {
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Leave Room').click());
  await page.waitForSelector('[role="alertdialog"]');
}

const confirmButton = '[role="alertdialog"] button[aria-busy]';
const clickConfirm = (page) => page.click(confirmButton);

test('the room has a visible Leave Room button that asks for confirmation; Cancel keeps you in', async () => {
  const { fake, context, page } = await joinedGuest();
  await openLeaveDialog(page);
  const text = await page.$eval('[role="alertdialog"]', (el) => el.innerText);
  assert.match(text, /Are you sure you want to leave this room\?/);
  assert.match(text, /Cancel/);
  assert.match(text, /Leave Room/);

  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Cancel').click());
  await wait(300);
  assert.equal(await leaveDialog(page), null, 'dialog closed');
  assert.equal(await isInRoom(page), true, 'still in the room');
  assert.equal(fake.callsTo('leave_room').length, 0, 'no leave request sent');

  // Escape also cancels
  await openLeaveDialog(page);
  await page.keyboard.press('Escape');
  await wait(300);
  assert.equal(await leaveDialog(page), null);
  await context.close();
});

test('guest leaves: server called once, back to the home screen, room activity stops, name kept', async () => {
  const { fake, context, page, me } = await joinedGuest();
  await wait(4500); // lease renewals and transfer checks are running
  assert.ok(fake.callsTo('renew_connection_lease', me).length >= 1);

  await openLeaveDialog(page);
  assert.doesNotMatch(await page.$eval('[role="alertdialog"]', (el) => el.innerText), /You are the host/);
  await clickConfirm(page);
  await page.waitForFunction(() => !document.body.innerText.includes('Room Participants'), { timeout: 10000 });

  assert.equal(fake.callsTo('leave_room', me).length, 1);
  assert.equal(fake.state.members.some((m) => m.user_id === me), false, 'membership removed');
  assert.equal(await page.evaluate(() => new URL(location.href).searchParams.has('room')), false, 'invite code removed from the address');
  assert.match(await page.evaluate(() => document.body.innerText), /Left screening room/);
  assert.equal(await page.$('video'), null, 'player gone (playback stopped)');

  const leftAt = Date.now();
  await wait(10000); // longer than two renewal and transfer-check intervals
  const after = (name) => fake.callsTo(name, me).filter((c) => c.at > leftAt + 200).length;
  assert.equal(after('renew_connection_lease'), 0, 'lease renewals stopped');
  assert.equal(after('auto_transfer_host'), 0, 'host-transfer checks stopped');

  const name = await page.evaluate(() => [localStorage.getItem('watchparty_user_name'), localStorage.getItem('watchparty_user_name_chosen')]);
  assert.deepEqual(name, ['Gus', '1'], 'display name kept for future rooms');
  await context.close();
});

test('host leaving: the dialog explains the hand-over and the server picks a new host', async () => {
  const { fake, context, page, me } = await joinedGuest({ asHost: true });
  // Another guest is in the room too
  fake.state.members.push({ id: 'g2', room_id: fake.state.room.id, user_id: 'guest-2', name: 'Gina', avatar: '', color: '#06B6D4', is_host: false, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
  assert.equal(fake.state.room.host_id, me);
  await openLeaveDialog(page);
  assert.match(await page.$eval('[role="alertdialog"]', (el) => el.innerText), /You are the host\. Hosting will pass/);
  await clickConfirm(page);
  await page.waitForFunction(() => !document.body.innerText.includes('Room Participants'), { timeout: 10000 });
  assert.equal(fake.state.room.host_id, 'guest-2', 'hosting handed over at once (by leave_room, no lease wait)');
  await context.close();
});

test('rejoining later through the same invite link', async () => {
  const { fake, context, page, me } = await joinedGuest();
  await openLeaveDialog(page);
  await clickConfirm(page);
  await page.waitForFunction(() => !document.body.innerText.includes('Room Participants'), { timeout: 10000 });

  await page.goto(`${baseUrl}?room=${fake.state.room.code}`);
  await inRoom(page);
  assert.equal(fake.callsTo('join_room', me).length, 2, 'joined again');
  assert.equal(fake.state.members.some((m) => m.user_id === me), true);
  assert.equal(await page.$('#display-name-input'), null, 'not asked for a name again');
  await context.close();
});

test('network failure: stays in the room with a clear message; trying again works', async () => {
  const { fake, context, page, me } = await joinedGuest();
  fake.state.rpcBehavior.leave_room = 'network-error';
  await openLeaveDialog(page);
  await clickConfirm(page);
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"] [role="alert"]'), { timeout: 20000 });
  const message = await page.$eval('[role="alertdialog"] [role="alert"]', (el) => el.innerText);
  assert.match(message, /Could not leave the room/);
  assert.match(message, /Network problem/);
  assert.match(message, /still in the room/);
  assert.equal(await isInRoom(page), true, 'did not navigate away');
  assert.equal(await page.evaluate(() => new URL(location.href).searchParams.get('room')), fake.state.room.code);

  // Server refuses → also stays
  fake.state.rpcBehavior.leave_room = 'server-error';
  await clickConfirm(page);
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"] [role="alert"]')?.innerText.includes('could not process'), { timeout: 20000 });
  assert.equal(await isInRoom(page), true);

  // Network back → leaving works
  fake.state.rpcBehavior.leave_room = 'ok';
  await clickConfirm(page);
  await page.waitForFunction(() => !document.body.innerText.includes('Room Participants'), { timeout: 10000 });
  assert.equal(fake.callsTo('leave_room', me).length, 3);
  await context.close();
});

test('duplicate clicks send one request and show a loading state', async () => {
  const { fake, context, page, me } = await joinedGuest();
  fake.state.rpcBehavior.leave_room = { delayMs: 2000 };
  await openLeaveDialog(page);
  // Three clicks in the same instant
  await page.$eval(confirmButton, (button) => {
    button.click();
    button.click();
    button.click();
  });
  await wait(300);
  const busy = await page.$eval(confirmButton, (b) => ({ text: b.innerText, disabled: b.disabled, busy: b.getAttribute('aria-busy') }));
  assert.deepEqual(busy, { text: 'Leaving…', disabled: true, busy: 'true' });
  await page.keyboard.press('Escape'); // ignored while leaving
  assert.notEqual(await leaveDialog(page), null);
  await page.waitForFunction(() => !document.body.innerText.includes('Room Participants'), { timeout: 10000 });
  assert.equal(fake.callsTo('leave_room', me).length, 1, 'exactly one leave request');
  await context.close();
});

test('the Library button browses without leaving', async () => {
  const { fake, context, page } = await joinedGuest();
  await page.click('button[aria-label="Browse the library (you stay in the room)"]');
  await wait(500);
  assert.equal(fake.callsTo('leave_room').length, 0);
  assert.equal(await page.evaluate(() => new URL(location.href).searchParams.has('room')), true, 'still in the room');
  await context.close();
});
