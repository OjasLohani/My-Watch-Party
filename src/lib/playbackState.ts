// Types for synchronized video playback.
// All timestamps are epoch milliseconds on the SERVER clock unless noted.

/** The room's shared playback state, as stored in `room_playback`. */
export interface PlaybackSnapshot {
  movieId: string;
  isPlaying: boolean;
  /** Seconds into the video at `updatedAtMs` */
  position: number;
  /** Playback speed (1 = normal) */
  rate: number;
  /** Server time when this state was set */
  updatedAtMs: number;
  /** Increases with every change; higher wins */
  version: number;
  /** Auth user id of the host who set it */
  updatedBy: string;
}

/** What a viewer's player should do to stay in sync. */
export type CorrectionDecision =
  | { kind: 'none' }
  | { kind: 'seek' }
  | { kind: 'rate'; rate: number };

/** One round trip to the server clock, all values in epoch ms. */
export interface ClockSample {
  /** Local time just before the request */
  sentAt: number;
  /** Server time reported in the response */
  serverMs: number;
  /** Local time when the response arrived */
  receivedAt: number;
}
