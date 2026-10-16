import { loadYouTubeApi, YT_STATE, type YTPlayer } from './youtubeApi';

/**
 * The parts of an HTMLVideoElement the player logic uses. A real <video>
 * element satisfies it, and so does YouTubeMedia below.
 */
export interface PlayableMedia {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  readonly error: { code: number } | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
}

/** Human-readable reasons for YouTube player error codes */
export function youTubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'this YouTube link is not valid';
    case 5:
      return 'the video cannot be played in this browser';
    case 100:
      return 'the video was removed or is private';
    case 101:
    case 150:
    case 153:
      return 'the owner of this video does not allow it to be played on other websites';
    case -1:
      return 'the YouTube player could not be loaded (check the connection or a content blocker)';
    default:
      return `YouTube reported an error (${code})`;
  }
}

const POLL_MS = 250;

/** Player container -> its adapter (lets test pages read the player state) */
export const youTubeMediaByContainer = new WeakMap<HTMLElement, YouTubeMedia>();
const PLAY_BLOCKED_AFTER_MS = 3000;

/**
 * Wraps the official YouTube IFrame player so it behaves like a <video>
 * element: same properties, and the same events (play, playing, pause,
 * waiting, seeking, seeked, canplay, loadedmetadata, durationchange,
 * timeupdate, ended, error, emptied). The existing synchronization code
 * can then drive YouTube exactly like a video file.
 *
 * YouTube's own controls are hidden (controls=0); the app's controls are
 * used instead, so guests cannot operate the player directly.
 */
export class YouTubeMedia extends EventTarget implements PlayableMedia {
  private player: YTPlayer | null = null;
  private ready = false;
  private state: number = YT_STATE.UNSTARTED;
  private wantsPaused = true; // like HTMLMediaElement.paused
  private seekTarget: number | null = null;
  private metadataSent = false;
  private lastDuration = 0;
  private lastTime = -1;
  private pendingPlay: { resolve: () => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private destroyed = false;
  private mount: HTMLElement;
  private savedVolume = 85;
  private savedMuted = false;
  private readonly videoId: string;
  private readonly container: HTMLElement;
  errorCode: number | null = null;

  constructor(container: HTMLElement, videoId: string) {
    super();
    this.container = container;
    this.videoId = videoId;
    // The API replaces this element with its iframe; React never manages it
    this.mount = document.createElement('div');
    container.appendChild(this.mount);
    youTubeMediaByContainer.set(container, this);
    void this.create();
  }

  private async create() {
    try {
      const YT = await loadYouTubeApi();
      if (this.destroyed) return;
      this.player = new YT.Player(this.mount, {
        width: '100%',
        height: '100%',
        videoId: this.videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => this.onReady(),
          onStateChange: (e) => this.onStateChange(e.data),
          onError: (e) => this.fail(e.data),
        },
      });
    } catch {
      this.fail(-1);
    }
  }

  private emit(type: string) {
    if (!this.destroyed) this.dispatchEvent(new Event(type));
  }

  private onReady() {
    this.ready = true;
    this.player?.setVolume(this.savedVolume);
    if (this.savedMuted) this.player?.mute();
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    if (!this.wantsPaused) this.player?.playVideo(); // play() was called before ready
  }

  private fail(code: number) {
    this.errorCode = code;
    this.wantsPaused = true;
    this.rejectPendingPlay(new DOMException('YouTube error', 'NotSupportedError'));
    this.emit('error');
  }

  private finishSeek() {
    if (this.seekTarget === null) return;
    this.seekTarget = null;
    this.emit('seeked');
    this.emit('canplay');
  }

  private onStateChange(state: number) {
    this.state = state;
    switch (state) {
      case YT_STATE.PLAYING:
        if (this.wantsPaused) {
          // Started from outside the app (e.g. system media controls)
          this.wantsPaused = false;
          this.emit('play');
        }
        this.finishSeek();
        this.emit('playing');
        if (this.pendingPlay) {
          clearTimeout(this.pendingPlay.timer);
          this.pendingPlay.resolve();
          this.pendingPlay = null;
        }
        break;
      case YT_STATE.PAUSED:
        if (!this.wantsPaused && this.seekTarget === null) {
          this.wantsPaused = true;
          this.emit('pause');
        }
        this.finishSeek();
        break;
      case YT_STATE.BUFFERING:
        if (!this.wantsPaused) this.emit('waiting');
        break;
      case YT_STATE.ENDED:
        this.wantsPaused = true;
        this.emit('pause');
        this.emit('ended');
        break;
      case YT_STATE.CUED:
        this.poll();
        break;
    }
  }

  private poll() {
    const p = this.player;
    if (!p || !this.ready) return;
    const duration = p.getDuration();
    if (duration > 0 && duration !== this.lastDuration) {
      this.lastDuration = duration;
      this.emit('durationchange');
    }
    if (!this.metadataSent && duration > 0) {
      this.metadataSent = true;
      this.emit('loadedmetadata');
      this.emit('canplay');
    }
    const time = p.getCurrentTime();
    if (this.seekTarget !== null && Math.abs(time - this.seekTarget) < 0.75 && this.state !== YT_STATE.BUFFERING) {
      this.finishSeek();
    }
    if (time !== this.lastTime) {
      this.lastTime = time;
      this.emit('timeupdate');
    }
  }

  private rejectPendingPlay(error: unknown) {
    if (!this.pendingPlay) return;
    clearTimeout(this.pendingPlay.timer);
    this.pendingPlay.reject(error);
    this.pendingPlay = null;
  }

  // --- HTMLMediaElement-like API ---

  get currentTime() {
    return this.ready && this.player ? this.player.getCurrentTime() : 0;
  }

  set currentTime(seconds: number) {
    if (!this.ready || !this.player || !Number.isFinite(seconds)) return;
    this.seekTarget = Math.max(0, seconds);
    this.player.seekTo(this.seekTarget, true);
    this.emit('seeking');
  }

  get duration() {
    return this.lastDuration > 0 ? this.lastDuration : NaN;
  }

  get paused() {
    return this.wantsPaused;
  }

  get ended() {
    return this.state === YT_STATE.ENDED;
  }

  get seeking() {
    return this.seekTarget !== null;
  }

  get readyState() {
    if (!this.ready || this.lastDuration <= 0) return 0;
    return this.state === YT_STATE.BUFFERING || this.seekTarget !== null ? 2 : 4;
  }

  get playbackRate() {
    return this.ready && this.player ? this.player.getPlaybackRate() : 1;
  }

  set playbackRate(rate: number) {
    // YouTube supports fixed speeds only; the sync code uses 1 for YouTube
    if (this.ready && this.player && rate === 1) this.player.setPlaybackRate(1);
  }

  get volume() {
    return this.savedVolume / 100;
  }

  set volume(value: number) {
    this.savedVolume = Math.round(Math.min(1, Math.max(0, value)) * 100);
    if (this.ready) this.player?.setVolume(this.savedVolume);
  }

  get muted() {
    return this.savedMuted;
  }

  set muted(value: boolean) {
    this.savedMuted = value;
    if (!this.ready) return;
    if (value) this.player?.mute();
    else this.player?.unMute();
  }

  get error() {
    return this.errorCode === null ? null : { code: this.errorCode };
  }

  play(): Promise<void> {
    if (this.errorCode !== null) return Promise.reject(new DOMException('YouTube error', 'NotSupportedError'));
    this.rejectPendingPlay(new DOMException('Superseded', 'AbortError'));
    const wasPaused = this.wantsPaused;
    this.wantsPaused = false;
    if (wasPaused) this.emit('play');
    if (this.ready) this.player?.playVideo();
    if (this.state === YT_STATE.PLAYING) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Still not playing and not loading: the browser blocked it
        if (this.state !== YT_STATE.PLAYING && this.state !== YT_STATE.BUFFERING) {
          this.pendingPlay = null;
          this.wantsPaused = true;
          reject(new DOMException('Playback was blocked', 'NotAllowedError'));
        }
      }, PLAY_BLOCKED_AFTER_MS);
      this.pendingPlay = { resolve, reject, timer };
    });
  }

  pause(): void {
    this.rejectPendingPlay(new DOMException('Paused', 'AbortError'));
    const wasPaused = this.wantsPaused;
    this.wantsPaused = true;
    if (this.ready) this.player?.pauseVideo();
    if (!wasPaused) this.emit('pause');
  }

  /** Retry after an error: cue the video again */
  load(): void {
    this.errorCode = null;
    this.metadataSent = false;
    this.lastDuration = 0;
    this.seekTarget = null;
    this.emit('emptied');
    if (this.ready && this.player) this.player.cueVideoById(this.videoId);
    else if (!this.player) void this.create();
  }

  destroy(): void {
    this.destroyed = true;
    clearInterval(this.pollTimer);
    this.rejectPendingPlay(new DOMException('Destroyed', 'AbortError'));
    try {
      this.player?.destroy();
    } catch {
      // the iframe may already be gone
    }
    this.player = null;
    this.container.replaceChildren();
  }
}
