// Real-browser tests of YouTube videos in the actual app ("real room"
// mode) against the fake Supabase backend (fakeSupabase.mjs): the
// "Watch YouTube Together" button and dialog, host-only rules (also after
// host changes), the shared queue and switching between YouTube videos
// and catalog movies.
// YouTube's oEmbed check is faked per test; the player is the real one.
// Synchronization of YouTube playback itself: youtube-sync.browser.mjs.
// Database rules (host-only, valid ids, titles): supabase/tests/stage4a.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, launchChrome, wait } from './browserEnv.mjs';
import { createFakeSupabase, FAKE_SUPABASE_URL, FAKE_ANON_KEY } from './fakeSupabase.mjs';

const BUNNY = 'aqz-KE-bpKQ';
const NOT_EMBEDDABLE = 'AAAAAAAAAAA';
const MISSING = 'BBBBBBBBBBB';
const OTHER = 'M7lc1UVf-VE';

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

/** Joins the fake room through the invite link, as host or guest.
 *  Pass `fake` to put a second person in the same room. */
async function joined({ asHost = false, setup, fake: shared, width = 1400, height = 1000 } = {}) {
  const fake = shared ?? createFakeSupabase();
  if (!shared) fake.state.oembed = {
    [BUNNY]: { title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film' },
    [OTHER]: { title: 'YouTube Developers Live: Embedded Web Player Customization' },
    [NOT_EMBEDDABLE]: { status: 401 },
    [MISSING]: { status: 404 },
  };
  setup?.(fake);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('watchparty_user_name', 'Gus');
    localStorage.setItem('watchparty_user_name_chosen', '1');
  });
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
  await page.waitForFunction(() => document.body.innerText.includes('Room Participants'), { timeout: 20000 });
  return { fake, context, page };
}

const clickButtonWithText = (page, text) =>
  page.evaluate((t) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t || b.textContent.trim().startsWith(t));
    button?.click();
    return Boolean(button);
  }, text);

async function openQueue(page) {
  assert.ok(await clickButtonWithText(page, 'Queue ('), 'queue tab');
  await wait(200);
}

const YT_BUTTON = 'Watch YouTube Together';

/** The dedicated button under the player (not in the queue) */
const youTubeButton = (page) => page.evaluateHandle(() =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Watch YouTube Together')));

async function openYouTubeDialog(page) {
  assert.ok(await clickButtonWithText(page, YT_BUTTON), 'YouTube button');
  await page.waitForSelector('#youtube-link-input');
}

/** The queue tab no longer has its own YouTube button */
const queueHasYouTubeButton = (page) =>
  page.$$eval('#room-tab-panel button', (bs) => bs.some((b) => /youtube/i.test(b.textContent)));

const guestMessageShown = (page) => page.waitForFunction(() =>
  [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent.includes('Only the host can choose a YouTube video.')),
{ timeout: 5000 });

async function checkLink(page, link) {
  await page.$eval('#youtube-link-input', (input) => {
    input.select();
  });
  await page.type('#youtube-link-input', link);
  await page.keyboard.press('Enter');
}

const dialogError = (page) =>
  page.waitForSelector('[role="dialog"] [role="alert"]', { timeout: 10000 }).then((el) => el.evaluate((e) => e.innerText));

const playerFrame = (page) =>
  page.evaluate(() => document.querySelector('[role="region"][aria-label^="Video player"] iframe')?.src ?? null);

test('guests: see the YouTube button but only get a message; the host\'s video plays for them, locked', async () => {
  const { fake, context, page } = await joined({
    setup: (f) => {
      f.state.playback = {
        room_id: f.state.room.id, movie_id: `yt:${BUNNY}`, is_playing: false, position_sec: 12,
        playback_rate: 1, version: 3, updated_at_ms: Date.now(), updated_by: f.state.room.host_id,
      };
    },
  });
  // The dedicated button is visible to guests, outside the queue
  const button = await youTubeButton(page);
  assert.ok(await button.evaluate((b) => Boolean(b) && b.offsetParent !== null), 'button visible');
  assert.match(await button.evaluate((b) => b.innerText), /The host chooses the video/);
  await button.click();
  await guestMessageShown(page);
  assert.equal(await page.$('#youtube-link-input'), null, 'no dialog for guests');
  await openQueue(page);
  assert.equal(await queueHasYouTubeButton(page), false);

  await page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  assert.match(await playerFrame(page), new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${BUNNY}\\?`));
  // Title looked up from YouTube (oEmbed) because it was not in the queue
  await page.waitForFunction(() => document.body.innerText.includes('Big Buck Bunny 60fps 4K'), { timeout: 10000 });
  const locked = await page.evaluate(() => document.querySelector('[role="region"] button[aria-label="Play"]')?.disabled);
  assert.equal(locked, true, 'guest cannot play/pause');
  assert.equal(fake.callsTo('set_playback').length + fake.callsTo('playlist_add_video').length, 0, 'guest never publishes');
  await context.close();
});

test('host: invalid, non-embeddable and missing videos are refused with clear messages', async () => {
  const { fake, context, page } = await joined({ asHost: true });
  await openYouTubeDialog(page);

  const cases = [
    ['https://vimeo.com/76979871', /Only YouTube links/],
    ['<iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ"></iframe>', /not embed code/],
    ['https://www.youtube.com/watch?v=tooshort', /no valid video ID/],
    ['https://www.youtube.com/playlist?list=PL123', /playlist/],
    [`https://youtu.be/${NOT_EMBEDDABLE}`, /does not allow it to be played on other websites/],
    [`https://www.youtube.com/shorts/${MISSING}`, /does not exist, is private, or was removed/],
  ];
  for (const [link, message] of cases) {
    await checkLink(page, link);
    await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('[role="dialog"] [role="alert"]')?.innerText ?? ''),
      { timeout: 10000 }, message.source).catch(async (e) => { throw new Error(`${link}: ${await page.evaluate(() => document.querySelector("[role=dialog]").innerText)}`, { cause: e }); });
    assert.equal(await page.$('[data-testid="youtube-preview"]'), null, `no preview for ${link}`);
  }
  assert.equal(fake.callsTo('playlist_add_video').length + fake.callsTo('set_playback').length, 0, 'nothing was sent');
  // Escape closes the dialog
  await page.keyboard.press('Escape');
  await wait(200);
  assert.equal(await page.$('#youtube-link-input'), null);
  await context.close();
});

test('host: add to queue → everyone sees the title → play it → switch back to a movie', async () => {
  const { fake, context, page } = await joined({
    asHost: true,
    setup: (f) => {
      f.state.playlist.push({ id: 99, room_id: f.state.room.id, movie_id: 'movie-2', position: 0, added_by: 'x', added_by_name: 'Hana', title: null });
    },
  });
  // The queue keeps its films and actions, but no longer has a YouTube button
  await openQueue(page);
  assert.equal(await queueHasYouTubeButton(page), false, 'queue has no YouTube button (host)');
  assert.ok(await page.$('button[aria-label="Play Cosmos: Nebula Odyssey"]'), 'queued films still playable');

  await openYouTubeDialog(page);
  await checkLink(page, `youtube.com/watch?v=${BUNNY}&t=30s`); // no https://, extra parameters
  await page.waitForSelector('[data-testid="youtube-preview"]', { timeout: 10000 });
  const preview = await page.$eval('[data-testid="youtube-preview"]', (el) => ({
    text: el.innerText, img: el.querySelector('img').src,
  }));
  assert.match(preview.text, /Big Buck Bunny 60fps 4K/);
  assert.equal(preview.img, `https://i.ytimg.com/vi/${BUNNY}/hqdefault.jpg`);

  await clickButtonWithText(page, 'Add to Queue');
  await page.waitForFunction(() => !document.querySelector('#youtube-link-input'), { timeout: 10000 });
  const [add] = fake.callsTo('playlist_add_video');
  assert.deepEqual(add.body, {
    p_code: fake.state.room.code, p_movie_id: `yt:${BUNNY}`,
    p_title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
  }, 'only the ID and title are sent (never a URL or HTML)');
  await page.waitForSelector(`button[aria-label="Play Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film"]`, { timeout: 10000 });

  // Adding it again: the server's duplicate message is shown
  await openYouTubeDialog(page);
  await checkLink(page, `https://youtu.be/${BUNNY}`);
  await page.waitForSelector('[data-testid="youtube-preview"]');
  await clickButtonWithText(page, 'Add to Queue');
  assert.match(await dialogError(page), /already in the queue/);
  await page.keyboard.press('Escape');

  // Selecting the queued video switches everyone to it
  await page.click(`button[aria-label="Play Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film"]`);
  await page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  assert.equal(fake.state.playback.movie_id, `yt:${BUNNY}`);
  assert.equal(await page.$('[role="region"][aria-label^="Video player"] video'), null, 'file player replaced');

  // Switching back to a catalog movie
  await page.click('button[aria-label="Play Cosmos: Nebula Odyssey"]');
  await page.waitForFunction(() => document.querySelector('[role="region"][aria-label^="Video player"] video'), { timeout: 15000 });
  assert.equal(fake.state.playback.movie_id, 'movie-2');
  assert.equal(await playerFrame(page), null, 'YouTube player removed');
  await context.close();
});

test('host: Watch Together makes it the room\'s current video; a guest joining later gets the same video', async () => {
  const { fake, context, page } = await joined({ asHost: true });
  await openYouTubeDialog(page);
  await checkLink(page, `https://m.youtube.com/watch?v=${OTHER}`);
  await page.waitForSelector('[data-testid="youtube-preview"]', { timeout: 10000 });
  const dialogText = await page.$eval('[role="dialog"]', (el) => el.innerText);
  assert.match(dialogText, /Watch YouTube Together/i);
  assert.match(dialogText, /Cancel/);
  await clickButtonWithText(page, 'Watch Together');
  await page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  const call = fake.callsTo('set_playback').at(-1);
  assert.deepEqual(
    { movie: call.body.p_movie_id, playing: call.body.p_is_playing, position: call.body.p_position },
    { movie: `yt:${OTHER}`, playing: true, position: 0 },
  );
  assert.match(await playerFrame(page), new RegExp(`/embed/${OTHER}\\?`));
  await page.waitForFunction(() => document.body.innerText.includes('YouTube Developers Live'), { timeout: 10000 });
  assert.equal(fake.callsTo('playlist_add_video').length, 0, 'not just queued');
  assert.equal(fake.state.room.current_movie_id, `yt:${OTHER}`, 'the room\'s current video');

  // A guest who joins now gets the same YouTube video, locked to the host
  const guest = await joined({ fake });
  await guest.page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  assert.match(await playerFrame(guest.page), new RegExp(`/embed/${OTHER}\\?`));
  assert.equal(await guest.page.evaluate(() =>
    document.querySelector('[role="region"] button[aria-label="Play"], [role="region"] button[aria-label="Pause"]')?.disabled), true);
  await guest.context.close();
  await context.close();
});

test('host transfer: the old host loses the YouTube choice, the new host gains it', async () => {
  const { fake, context, page } = await joined({ asHost: true });
  const guest = await joined({ fake });
  const guestId = fake.callsTo('join_room').at(-1).userId;
  // The host's page loads the member list again (realtime is not simulated)
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Room Participants'), { timeout: 20000 });

  // Manual transfer from the Participants tab
  assert.ok(await clickButtonWithText(page, 'Participants'));
  await page.waitForSelector('button[aria-label^="Make Host"]');
  await page.click('button[aria-label^="Make Host"]');
  await page.waitForFunction(() => /The host chooses the video/.test(document.body.innerText), { timeout: 10000 });
  assert.equal(fake.state.room.host_id, guestId);
  assert.ok(await clickButtonWithText(page, YT_BUTTON));
  await guestMessageShown(page);
  assert.equal(await page.$('#youtube-link-input'), null, 'old host cannot open the dialog');

  // The new host's page learns it from the server and can choose a video
  await guest.page.waitForFunction(() => /Paste a link, everyone watches in sync/.test(document.body.innerText), { timeout: 15000 });
  await openYouTubeDialog(guest.page);
  await checkLink(guest.page, `https://youtu.be/${BUNNY}`);
  await guest.page.waitForSelector('[data-testid="youtube-preview"]', { timeout: 10000 });
  await clickButtonWithText(guest.page, 'Watch Together');
  await guest.page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  const call = fake.callsTo('set_playback').at(-1);
  assert.equal(call.userId, guestId, 'published by the new host');
  assert.equal(call.body.p_movie_id, `yt:${BUNNY}`);
  await guest.context.close();
  await context.close();
});

test('automatic transfer: a guest who becomes host can choose a YouTube video', async () => {
  const { fake, context, page } = await joined();
  const me = fake.callsTo('join_room').at(-1).userId;
  assert.match(await (await youTubeButton(page)).evaluate((b) => b.innerText), /The host chooses the video/);
  fake.state.room.host_id = me; // the server moved hosting (e.g. the host's lease expired)
  await page.waitForFunction(() => /Paste a link, everyone watches in sync/.test(document.body.innerText), { timeout: 15000 });
  await openYouTubeDialog(page);
  await context.close();
});

test('phones: the YouTube button is full width right under the player', async () => {
  const { context, page } = await joined({ asHost: true, width: 390, height: 844 });
  const layout = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Watch YouTube Together'));
    const player = document.querySelector('[role="region"][aria-label^="Video player"]');
    const b = button.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    return { width: b.width, playerWidth: p.width, gap: b.top - p.bottom, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(Math.abs(layout.width - layout.playerWidth) < 2, `full width (${layout.width} vs ${layout.playerWidth})`);
  assert.ok(layout.gap >= 0 && layout.gap < 30, `directly below the player (${layout.gap}px)`);
  assert.equal(layout.overflow, 0);
  await openYouTubeDialog(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'dialog fits');
  await context.close();
});
