// Loads the official YouTube IFrame Player API once
// (https://developers.google.com/youtube/iframe_api_reference).
// Only the parts this app uses are typed here.

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  cueVideoById(videoId: string): void;
  destroy(): void;
}

export interface YTPlayerOptions {
  width?: string;
  height?: string;
  videoId: string;
  host?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Player states (YT.PlayerState) */
export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const API_URL = 'https://www.youtube.com/iframe_api';
const LOAD_TIMEOUT_MS = 15_000;
let apiPromise: Promise<YTNamespace> | null = null;

/** Resolves with window.YT once the official API is ready */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('timeout')), LOAD_TIMEOUT_MS);
    const fail = (err: Error) => {
      clearTimeout(timer);
      apiPromise = null; // allow a later retry
      reject(err);
    };
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error('YouTube API missing'));
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => fail(new Error('YouTube API could not be loaded'));
    document.head.appendChild(script);
  });
  return apiPromise;
}
