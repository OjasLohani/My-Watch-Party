// Checks that every catalog video URL is reachable and really a video,
// the way a browser requests it (a byte-range request).
// Usage: npm run check:videos
import { OPEN_MOVIE_VIDEOS } from '../src/mockData.ts';

// Identify ourselves honestly; video hosts throttle anonymous bursts.
const USER_AGENT = 'WatchPartyLinkCheck/1.0 (student watch-party project; occasional manual link check)';
const PAUSE_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function looksLikeVideo(bytes) {
  const isWebm = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const isMp4 = Buffer.from(bytes.slice(4, 8)).toString('latin1') === 'ftyp';
  return isWebm || isMp4;
}

let failures = 0;
for (const [name, video] of Object.entries(OPEN_MOVIE_VIDEOS)) {
  for (const [i, url] of [video.url, ...video.fallbacks].entries()) {
    const label = `${name} ${i === 0 ? 'primary' : `backup ${i}`}`;
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-15', 'User-Agent': USER_AGENT }, redirect: 'follow' });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? '';
      const ok = (res.status === 206 || res.status === 200) && type.startsWith('video/') && looksLikeVideo(bytes);
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: HTTP ${res.status}, ${type}${res.status === 206 ? ', seekable' : ''}`);
      if (!ok) failures++;
    } catch (err) {
      console.log(`FAIL ${label}: ${err.message}`);
      failures++;
    }
    await sleep(PAUSE_MS);
  }
}

console.log(failures ? `\n${failures} source(s) failed.` : '\nAll video sources are reachable.');
process.exit(failures ? 1 : 0);
