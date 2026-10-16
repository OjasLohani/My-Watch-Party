// Real-browser tests of YouTube videos in the actual app ("real room"
// mode) against the fake Supabase backend (fakeSupabase.mjs): the Add
// YouTube Video dialog, host-only controls, the shared queue and
// switching between YouTube videos and catalog movies.
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

/** Joins the fake room through the invite link, as host or guest */
async function joined({ asHost = false, setup } = {}) {
  const fake = createFakeSupabase();
  fake.state.oembed = {
    [BUNNY]: { title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film' },
    [OTHER]: { title: 'YouTube Developers Live: Embedded Web Player Customization' },
    [NOT_EMBEDDABLE]: { status: 401 },
    [MISSING]: { status: 404 },
  };
  setup?.(fake);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
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

async function openYouTubeDialog(page) {
  await openQueue(page);
  assert.ok(await clickButtonWithText(page, 'YouTube'), 'YouTube button');
  await page.waitForSelector('#youtube-link-input');
}

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

test('guests: no YouTube button; a YouTube video chosen by the host plays for them, locked', async () => {
  const { fake, context, page } = await joined({
    setup: (f) => {
      f.state.playback = {
        room_id: f.state.room.id, movie_id: `yt:${BUNNY}`, is_playing: false, position_sec: 12,
        playback_rate: 1, version: 3, updated_at_ms: Date.now(), updated_by: f.state.room.host_id,
      };
    },
  });
  await openQueue(page);
  assert.equal(await clickButtonWithText(page, 'YouTube'), false, 'guests have no YouTube button');

  await page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  assert.match(await playerFrame(page), new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${BUNNY}\\?`));
  // Title looked up from YouTube (oEmbed) because it was not in the queue
  await page.waitForFunction(() => document.body.innerText.includes('Big Buck Bunny 60fps 4K'), { timeout: 10000 });
  const locked = await page.evaluate(() => document.querySelector('[role="region"] button[aria-label="Play"]')?.disabled);
  assert.equal(locked, true, 'guest cannot play/pause');
  assert.equal(fake.callsTo('set_playback').length, 0, 'guest never publishes');
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

test('host: Play Now starts a YouTube video for the room at once', async () => {
  const { fake, context, page } = await joined({ asHost: true });
  await openYouTubeDialog(page);
  await checkLink(page, `https://m.youtube.com/watch?v=${OTHER}`);
  await page.waitForSelector('[data-testid="youtube-preview"]', { timeout: 10000 });
  await clickButtonWithText(page, 'Play Now');
  await page.waitForFunction(() => document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]'), { timeout: 30000 });
  const call = fake.callsTo('set_playback').at(-1);
  assert.deepEqual(
    { movie: call.body.p_movie_id, playing: call.body.p_is_playing, position: call.body.p_position },
    { movie: `yt:${OTHER}`, playing: true, position: 0 },
  );
  assert.match(await playerFrame(page), new RegExp(`/embed/${OTHER}\\?`));
  await page.waitForFunction(() => document.body.innerText.includes('YouTube Developers Live'), { timeout: 10000 });
  await context.close();
});
