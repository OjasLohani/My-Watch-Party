// Real-browser tests of the redesigned interface (Phase 4), in demo mode
// (no Supabase): the dynamic spotlight film, search, My List, the Create
// and Join dialogs, responsive navigation and the room's tabs.
// Everything the room does with a real backend is covered by the other
// browser tests (leave, names, youtube-room, sync, lease).
//
// Run with: npm run test:browser
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, launchChrome, wait } from './browserEnv.mjs';
import { mockMovies } from '../../src/mockData.ts';

let server;
let baseUrl;
let browser;

before(async () => {
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_ANON_KEY = '';
  ({ server, baseUrl } = await startDevServer());
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function visitor({ width = 1440, height = 900, named = true } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  if (named) {
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('watchparty_user_name', 'Rita');
      localStorage.setItem('watchparty_user_name_chosen', '1');
    });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}

const firstFeatured = mockMovies.find((m) => m.featured) ?? mockMovies[0];
const indexOf = (movie) => mockMovies.findIndex((m) => m.id === movie.id);

/** What the spotlight shows right now */
const hero = (page) => page.$eval('#home', (el) => ({
  title: el.querySelector('h1').textContent.trim(),
  text: el.innerText,
  watchLabel: el.querySelector('button[aria-label^="Watch Now"]').getAttribute('aria-label'),
}));

function assertHeroShows(state, movie) {
  assert.equal(state.title, movie.title);
  assert.ok(state.text.includes(movie.description), 'description of the same film');
  assert.ok(state.text.includes(movie.rating.toFixed(1)), 'its rating');
  assert.ok(state.text.includes(String(movie.year)), 'its year');
  assert.ok(state.text.includes(movie.duration), 'its duration');
  assert.equal(state.watchLabel, `Watch Now: ${movie.title}`, 'Watch Now targets this film');
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const inRoom = (page) => page.waitForFunction(() => document.body.innerText.includes('Room Participants'), { timeout: 20000 });

test('spotlight: default film, arrows cycle through the catalog (wrapping), nothing plays', async () => {
  const { context, page, errors } = await visitor();
  await page.goto(baseUrl);
  await page.waitForSelector('#home h1');
  assertHeroShows(await hero(page), firstFeatured);

  await page.click('button[aria-label="Next film"]');
  assertHeroShows(await hero(page), mockMovies[(indexOf(firstFeatured) + 1) % mockMovies.length]);
  await page.click('button[aria-label="Previous film"]');
  await page.click('button[aria-label="Previous film"]');
  const previous = mockMovies[(indexOf(firstFeatured) - 1 + mockMovies.length) % mockMovies.length];
  assertHeroShows(await hero(page), previous);

  // Selecting films never starts playback or leaves the page
  assert.equal(await page.$('video'), null, 'no player');
  assert.equal(await page.evaluate(() => new URL(location.href).searchParams.has('room')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('spotlight: Top Rated items and poster cards select the film shown', async () => {
  const { context, page } = await visitor();
  await page.goto(baseUrl);
  await page.waitForSelector('#home h1');

  const top = [...mockMovies].sort((a, b) => b.rating - a.rating)[1];
  await page.click(`#home aside button[aria-label="Show ${top.title} in the spotlight"]`);
  assertHeroShows(await hero(page), top);
  assert.equal(await page.$eval(`#home aside button[aria-label="Show ${top.title} in the spotlight"]`, (b) => b.getAttribute('aria-current')), 'true');

  const card = mockMovies[2];
  await page.click(`#now-showing button[aria-label="Show ${card.title} in the spotlight"]`);
  assertHeroShows(await hero(page), card);
  assert.equal(await page.$eval(`#now-showing button[aria-label="Show ${card.title} in the spotlight"]`, (b) => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$('video'), null, 'still nothing playing');
  await context.close();
});

test('search: results list, keyboard selection updates the spotlight, empty results', async () => {
  const { context, page } = await visitor();
  await page.goto(baseUrl);
  const target = mockMovies.find((m) => m.title.startsWith('Sintel'));
  await page.type('nav input[aria-label="Search films"]', 'sintel');
  await page.waitForSelector('[role="listbox"] [role="option"]');
  const options = await page.$$eval('[role="listbox"] [role="option"]', (els) => els.map((e) => e.textContent));
  assert.ok(options.some((o) => o.includes(target.title)));
  await page.keyboard.press('Enter');
  await page.waitForFunction((t) => document.querySelector('#home h1').textContent.trim() === t, {}, target.title);
  assertHeroShows(await hero(page), target);

  // The library below is filtered by the same search
  assert.match(await page.$eval('#library', (el) => el.innerText), /Showing 1 of 8 films/);

  await page.$eval('nav input[aria-label="Search films"]', (el) => el.select());
  await page.type('nav input[aria-label="Search films"]', 'zzzz');
  await page.waitForFunction(() => document.querySelector('[role="listbox"]')?.innerText.includes('No films match'));
  await context.close();
});

test('Watch Now plays the film in the spotlight (demo room)', async () => {
  const { context, page } = await visitor();
  await page.goto(baseUrl);
  const chosen = mockMovies[3];
  await page.click(`#now-showing button[aria-label="Show ${chosen.title} in the spotlight"]`);
  await page.click(`#home button[aria-label="Watch Now: ${chosen.title}"]`);
  await page.waitForSelector(`[role="region"][aria-label^="Video player: ${chosen.title}"]`, { timeout: 15000 });
  await inRoom(page);
  await context.close();
});

test('My List: add from the spotlight and library, kept after reload, remove', async () => {
  const { context, page } = await visitor();
  await page.goto(baseUrl);
  const add = await page.waitForSelector('#home button[aria-pressed]');
  assert.equal(await add.evaluate((b) => b.textContent.trim()), 'Add to My List');
  await add.click();
  await page.waitForFunction(() => document.querySelector('#home button[aria-pressed="true"]')?.textContent.includes('In My List'));
  const other = mockMovies[4];
  await page.click(`#library button[aria-label="Add ${other.title} to My List"]`);

  const listTitles = () => page.$$eval('#my-list button[aria-label$="in the spotlight"]', (els) => els.map((e) => e.getAttribute('aria-label')));
  assert.deepEqual(await listTitles(), [`Show ${firstFeatured.title} in the spotlight`, `Show ${other.title} in the spotlight`]);

  await page.reload();
  await page.waitForSelector('#my-list');
  assert.equal((await listTitles()).length, 2, 'saved on this device');

  await page.click(`#library button[aria-label="Remove ${other.title} from My List"]`);
  assert.deepEqual(await listTitles(), [`Show ${firstFeatured.title} in the spotlight`]);
  await context.close();
});

test('Create Room: spotlight film preselected, validation, privacy choice, Escape', async () => {
  const { context, page } = await visitor({ named: false });
  await page.goto(baseUrl);
  const chosen = mockMovies[5];
  await page.click(`#now-showing button[aria-label="Show ${chosen.title} in the spotlight"]`);
  await page.click(`#home button[aria-label="Host a watch party with ${chosen.title}"]`);
  await page.waitForSelector('[aria-labelledby="modal-title"]');
  assert.equal(await page.$eval('#create-room-film', (s) => s.value), chosen.id, 'film preselected');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'create-room-title', 'first field focused');

  // Missing host name is refused with a message
  await page.click('[aria-labelledby="modal-title"] button[type="submit"]');
  await page.waitForSelector('[aria-labelledby="modal-title"] [role="alert"]');

  // Privacy cards behave as a radio group
  const radios = () => page.$$eval('[role="radiogroup"] [role="radio"]', (els) => els.map((e) => e.getAttribute('aria-checked')));
  assert.deepEqual(await radios(), ['true', 'false']);
  await page.click('[role="radiogroup"] [role="radio"]:last-child');
  assert.deepEqual(await radios(), ['false', 'true']);

  await page.keyboard.press('Escape');
  await wait(300);
  assert.equal(await page.$('[aria-labelledby="modal-title"]'), null, 'closed');
  await context.close();
});

test('Join Room: returning guests see their saved name; empty code is refused', async () => {
  const { context, page } = await visitor();
  await page.goto(baseUrl);
  await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes('Join Room')).click());
  await page.waitForSelector('[aria-labelledby="join-modal-title"]');
  assert.match(await page.$eval('[aria-labelledby="join-modal-title"]', (el) => el.innerText), /Joining as Rita/);
  await page.click('[aria-labelledby="join-modal-title"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="join-modal-title"] [role="alert"]')?.textContent.includes('Please enter a room code'));
  await page.type('#join-room-code', 'film-club-404');
  await page.click('[aria-labelledby="join-modal-title"] button[type="submit"]');
  await inRoom(page);
  assert.equal(await page.$('#display-name-input'), null, 'not asked for a name again');
  await context.close();
});

test('phones: bottom navigation (Categories, Search, My Room) and no sideways scrolling', async () => {
  for (const width of [320, 375, 430]) {
    const { context, page } = await visitor({ width, height: 800 });
    await page.goto(baseUrl);
    await page.waitForSelector('nav[aria-label="Mobile"]');
    assert.equal(await overflow(page), 0, `home fits ${width}px`);
    assert.equal(await page.$eval('nav[aria-label="Main"] ul', (el) => getComputedStyle(el).display), 'none', 'top links hidden');

    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Mobile"] button')].find((b) => b.textContent.includes('Categories')).click());
    await page.waitForFunction(() => {
      const r = document.getElementById('library').getBoundingClientRect();
      return r.top < window.innerHeight / 2 && r.bottom > 0;
    }, { timeout: 5000 });

    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Mobile"] button')].find((b) => b.textContent.includes('Search')).click());
    await page.waitForFunction(() => [...document.querySelectorAll('nav[aria-label="Main"] input[aria-label="Search films"]')]
      .some((i) => i.offsetParent !== null && i.getBoundingClientRect().width > 0), { timeout: 5000 });

    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Mobile"] button')].find((b) => b.textContent.includes('My Room')).click());
    await inRoom(page);
    assert.equal(await overflow(page), 0, `room fits ${width}px`);
    await context.close();
  }
});

test('no sideways scrolling on tablet, laptop and desktop widths', async () => {
  for (const [width, height] of [[768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
    const { context, page } = await visitor({ width, height });
    await page.goto(baseUrl);
    await page.waitForSelector('#home h1');
    assert.equal(await overflow(page), 0, `home fits ${width}px`);
    await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
    await inRoom(page);
    assert.equal(await overflow(page), 0, `room fits ${width}px`);
    await context.close();
  }
});

test('room: five accessible tabs, queue rules for viewers vs host, settings, reactions', async () => {
  const { context, page } = await visitor();
  await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
  await inRoom(page);

  const tabs = await page.$$eval('[role="tablist"] [role="tab"]', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(tabs, ['Chat', 'Participants', 'Reactions', 'Queue (3)', 'Polls']);

  // Keyboard: arrows move between tabs and show the matching panel
  await page.focus('#room-tab-chat');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'room-tab-people');
  assert.equal(await page.$eval('#room-tab-people', (t) => t.getAttribute('aria-selected')), 'true');
  assert.match(await page.$eval('#room-tab-panel', (p) => p.innerText), /Invite Friends/);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'room-tab-poll');
  assert.match(await page.$eval('#room-tab-panel', (p) => p.innerText), /Which film should the club screen/);

  // Viewers see the queue but no editing controls
  await page.click('#room-tab-playlist');
  assert.equal(await page.$('#room-tab-panel button[aria-label^="Remove"]'), null);
  assert.equal(await page.$$eval('#room-tab-panel button', (bs) => bs.some((b) => b.textContent.trim() === 'YouTube')), false);

  // Settings: room details; switching to host (demo) unlocks the queue controls
  await page.click('button[aria-label="Room settings"]');
  assert.match(await page.$eval('#room-settings-panel', (el) => el.innerText), /FILM-CLUB-404/);
  await page.evaluate(() => [...document.querySelectorAll('#room-settings-panel button')].find((b) => b.textContent.includes('Switch to host')).click());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => [...document.querySelectorAll('#room-tab-panel button')].some((b) => b.textContent.trim() === 'YouTube'));
  assert.ok(await page.$('#room-tab-panel button[aria-label^="Remove"]'), 'host can edit the queue');

  // Quick reactions float over the player
  await page.click('[role="group"][aria-label="Quick reactions"] button');
  await page.waitForSelector('.animate-reaction-float');
  await context.close();
});

test('room: Leave Room asks first; Cancel stays, Leave returns home', async () => {
  const { context, page } = await visitor();
  await page.goto(`${baseUrl}?room=FILM-CLUB-404`);
  await inRoom(page);
  const leave = () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Leave Room').click());
  await leave();
  await page.waitForSelector('[role="alertdialog"]');
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Cancel').click());
  await wait(300);
  assert.equal(await page.$('[role="alertdialog"]'), null);
  await leave();
  await page.click('[role="alertdialog"] button[aria-busy]');
  await page.waitForSelector('#home h1');
  assert.equal(await page.$('video'), null);
  await context.close();
});
