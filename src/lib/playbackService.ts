import type { PlaybackSnapshot, CorrectionDecision, ClockSample } from './playbackState';

// Synchronized playback math. Kept free of React / Supabase imports so it
// can be unit-tested directly (see tests/playbackSync.test.ts).
//
// How sync works:
//  1. The host's play / pause / seek is saved on the server as a snapshot
//     (position + server timestamp + version).
//  2. Every viewer estimates the difference between its clock and the
//     server clock, so it can compute where the video SHOULD be "now".
//  3. Each viewer compares its player with that expected position and
//     corrects: tiny drift is ignored, small drift is closed by playing
//     slightly faster/slower, large drift by jumping (seeking).

/** Drift below this is ignored (normal player jitter). */
export const DRIFT_IGNORE_MS = 120;
/** Drift at or above this is fixed by seeking instead of speed changes. */
export const DRIFT_SEEK_MS = 750;
/** While paused, viewers further than this from the host are moved. */
export const PAUSED_SEEK_MS = 250;
/** Largest speed change used for gentle correction (±20%). */
export const MAX_RATE_ADJUST = 0.2;
/** The host re-publishes its position if it drifts this far (e.g. after buffering). */
export const HOST_REPUBLISH_MS = 500;

/** Where the video should be at `serverNowMs`, in seconds. */
export function expectedPosition(
  snapshot: PlaybackSnapshot,
  serverNowMs: number,
  durationSec?: number
): number {
  let position = snapshot.position;
  if (snapshot.isPlaying) {
    position += (Math.max(0, serverNowMs - snapshot.updatedAtMs) / 1000) * snapshot.rate;
  }
  if (durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0) {
    position = Math.min(position, durationSec);
  }
  return Math.max(0, position);
}

/**
 * Decides how to correct a viewer's player.
 * @param driftMs local position minus expected position (positive = ahead)
 */
export function decideCorrection(driftMs: number, isPlaying: boolean): CorrectionDecision {
  const abs = Math.abs(driftMs);
  if (!isPlaying) {
    return abs > PAUSED_SEEK_MS ? { kind: 'seek' } : { kind: 'none' };
  }
  if (abs >= DRIFT_SEEK_MS) return { kind: 'seek' };
  if (abs <= DRIFT_IGNORE_MS) return { kind: 'none' };

  // Proportional speed change, e.g. 300 ms behind → play at ~1.14x.
  const adjust = Math.min(MAX_RATE_ADJUST, (abs / 1000) * 0.4 + 0.02);
  return { kind: 'rate', rate: driftMs > 0 ? 1 - adjust : 1 + adjust };
}

/**
 * Estimates (server clock − local clock) from round trips, NTP style:
 * the sample with the shortest round trip is the most trustworthy.
 */
export function pickClockOffset(samples: ClockSample[]): { offsetMs: number; rttMs: number } | null {
  let best: { offsetMs: number; rttMs: number } | null = null;
  for (const s of samples) {
    const rttMs = s.receivedAt - s.sentAt;
    if (!Number.isFinite(rttMs) || rttMs < 0 || !Number.isFinite(s.serverMs)) continue;
    const offsetMs = s.serverMs - (s.sentAt + s.receivedAt) / 2;
    if (!best || rttMs < best.rttMs) best = { offsetMs, rttMs };
  }
  return best;
}

/** YouTube viewers are moved (seek) only beyond this drift */
export const YOUTUBE_SEEK_MS = 1000;
/** While paused, YouTube viewers further than this from the host are moved */
export const YOUTUBE_PAUSED_SEEK_MS = 500;

/**
 * Drift correction for the YouTube player. YouTube only supports a few
 * fixed speeds (0.25×, 0.5× … 2×), so the gentle ±20 % speed nudging used
 * for video files is not possible; small drift is left alone and larger
 * drift is fixed with a seek (YouTube seeks are slower, so the threshold
 * is higher to avoid constant re-buffering).
 */
export function decideYouTubeCorrection(driftMs: number, isPlaying: boolean): CorrectionDecision {
  const limit = isPlaying ? YOUTUBE_SEEK_MS : YOUTUBE_PAUSED_SEEK_MS;
  return Math.abs(driftMs) > limit ? { kind: 'seek' } : { kind: 'none' };
}

/** Largest one-way delay we compensate for (anything above is likely an outlier) */
export const MAX_PUBLISH_LEAD_MS = 1000;

/**
 * The server stamps a host change when it ARRIVES, not when the host
 * clicked. While playing, the host's video moves on during that trip, so
 * the published position is moved forward by the estimated one-way delay
 * (half the measured round trip). Without this, every viewer would sit
 * that far behind the host.
 */
export function compensatePublishPosition(position: number, isPlaying: boolean, oneWayDelayMs: number): number {
  if (!isPlaying || !Number.isFinite(oneWayDelayMs) || oneWayDelayMs <= 0) return position;
  return position + Math.min(oneWayDelayMs, MAX_PUBLISH_LEAD_MS) / 1000;
}

/** True when `next` should replace `current` (newer version wins). */
export function isNewerSnapshot(current: PlaybackSnapshot | null, next: PlaybackSnapshot): boolean {
  if (!current) return true;
  if (next.version !== current.version) return next.version > current.version;
  return next.updatedAtMs > current.updatedAtMs;
}
