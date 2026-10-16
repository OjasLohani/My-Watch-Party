import type { Movie } from '../types';

// YouTube support. Only video IDs are ever stored or shared: a link is
// parsed here into an 11-character ID, and the official IFrame Player API
// builds the player from that ID. No URL, HTML or iframe from a user is
// ever inserted into the page.

/** Format of a YouTube video ID */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Prefix that marks a shared "movie" as a YouTube video, e.g. "yt:dQw4w9WgXcQ" */
export const YOUTUBE_MOVIE_PREFIX = 'yt:';

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

export type YouTubeLinkResult = { ok: true; videoId: string } | { ok: false; error: string };

/**
 * Extracts the video ID from a YouTube link. Supported:
 *   https://www.youtube.com/watch?v=ID   (also m. / music. and extra parameters)
 *   https://youtu.be/ID                  (also with ?t=…)
 *   https://www.youtube.com/shorts/ID
 * The scheme may be omitted ("youtu.be/ID").
 */
export function parseYouTubeLink(input: string): YouTubeLinkResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Paste a YouTube link.' };
  if (/[<>"'\s]/.test(text)) {
    return { ok: false, error: 'That does not look like a YouTube link. Paste the address of the video, not embed code.' };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: 'That does not look like a link.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only YouTube links (https://…) are supported.' };
  }

  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (SHORT_HOSTS.has(host)) {
    id = url.pathname.split('/')[1] ?? null;
  } else if (WATCH_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const shorts = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname);
      if (shorts) id = shorts[1];
    }
    if (!id && url.searchParams.get('list')) {
      return { ok: false, error: 'That is a playlist link. Open one video from it and paste that link instead.' };
    }
    if (id === null) {
      return { ok: false, error: 'Paste the link of a single video (youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…).' };
    }
  } else {
    return { ok: false, error: 'Only YouTube links are supported (youtube.com or youtu.be).' };
  }

  if (!id || !YOUTUBE_ID_PATTERN.test(id)) {
    return { ok: false, error: 'This YouTube link has no valid video ID. Check that the whole link was copied.' };
  }
  return { ok: true, videoId: id };
}

export const youTubeMovieId = (videoId: string) => `${YOUTUBE_MOVIE_PREFIX}${videoId}`;

/** The YouTube video ID inside a shared movie id, or null if it is not a (valid) YouTube one */
export function youTubeIdFromMovieId(movieId: string): string | null {
  if (!movieId.startsWith(YOUTUBE_MOVIE_PREFIX)) return null;
  const id = movieId.slice(YOUTUBE_MOVIE_PREFIX.length);
  return YOUTUBE_ID_PATTERN.test(id) ? id : null;
}

export const youTubeThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/** A YouTube video shown like a catalog movie */
export function youTubeMovie(videoId: string, title?: string): Movie {
  const thumbnail = youTubeThumbnail(videoId);
  return {
    id: youTubeMovieId(videoId),
    title: title?.trim() || 'YouTube video',
    description: '',
    backdropUrl: thumbnail,
    posterUrl: thumbnail,
    videoUrl: '',
    genre: 'YouTube',
    category: 'YouTube',
    year: new Date().getFullYear(),
    rating: 0,
    duration: 'YouTube',
    source: 'youtube',
    youtubeId: videoId,
  };
}

/**
 * Finds the movie for a shared movie id: a catalog movie, or a YouTube
 * video (title from `titles` if known). Unknown ids give undefined.
 */
export function resolveMovie(catalog: Movie[], movieId: string, titles?: Record<string, string>): Movie | undefined {
  const youtubeId = youTubeIdFromMovieId(movieId);
  if (youtubeId) return youTubeMovie(youtubeId, titles?.[movieId]);
  return catalog.find((m) => m.id === movieId);
}

export type YouTubeInfo =
  | { ok: true; title: string; thumbnailUrl: string; checked: true }
  | { ok: true; title: string; thumbnailUrl: string; checked: false } // could not check (offline)
  | { ok: false; error: string };

/**
 * Looks a video up with YouTube's public oEmbed endpoint (no API key):
 * gives the title, and tells whether the video exists and may be
 * embedded. Network problems do not block adding the video.
 */
export async function fetchYouTubeInfo(videoId: string, signal?: AbortSignal): Promise<YouTubeInfo> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fallback = { ok: true as const, title: 'YouTube video', thumbnailUrl: youTubeThumbnail(videoId), checked: false as const };
  let response: Response;
  try {
    response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, {
      signal: signal ?? AbortSignal.timeout(8000),
    });
  } catch {
    return fallback;
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: 'The owner of this video does not allow it to be played on other websites.' };
  }
  if (response.status === 400 || response.status === 404) {
    return { ok: false, error: 'This video does not exist, is private, or was removed.' };
  }
  if (!response.ok) return fallback;
  try {
    const data = (await response.json()) as { title?: unknown };
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 200) : 'YouTube video';
    return { ok: true, title, thumbnailUrl: youTubeThumbnail(videoId), checked: true };
  } catch {
    return fallback;
  }
}
