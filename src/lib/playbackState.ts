// Typed playback state for synchronized video playback
// All timestamps are epoch milliseconds unless otherwise noted.
// Command versions are monotonically increasing per room.

export interface PlaybackState {
  videoId: string;
  isPlaying: boolean;
  currentTime: number; // seconds, 0-based
  playbackRate: number; // e.g. 1.0 = normal, -1.0 = reverse, 2.0 = double-speed
  commandVersion: number; // monotonically increasing, last applied version by this client
  serverTimestamp: number; // epoch ms when this state was confirmed by server
}

export interface PlaybackCommand {
  type: 'play' | 'pause' | 'seek' | 'video-change';
  version: number; // command version, monotonically increasing
  payload: PlaybackCommandPayload;
  serverTimestamp: number; // epoch ms when command was generated on server
}

export interface PlaybackCommandPayload {
  videoId?: string; // for 'video-change' command
  currentTime?: number; // for 'seek' command, seconds
  isPlaying?: boolean; // for 'play'/'pause' command
}

export interface PlaybackUpdate {
  state: PlaybackState;
  /** How many ms the state is ahead of the server (positive = ahead, negative = behind) */
  driftMs: number;
  /** True if this state update is newer than what the client last applied */
  isNewer: boolean;
}

// Command version starting value per room
export const INITIAL_COMMAND_VERSION = 0;

// Drift correction thresholds
export const DRIFT_SEEK_THRESHOLD_MS = 500;   // If drift exceeds this, seek instead of rate adjust
export const DRIFT_RATE_ADJUST_MS = 200;      // How aggressively to correct rate
export const MAX_PLAYBACK_RATE = 4;           // Maximum allowed playbackRate
export const MIN_PLAYBACK_RATE = 0.25;        // Minimum allowed playbackRate