import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  Shield,
  AlertCircle,
  RefreshCw,
  Loader2
} from 'lucide-react';
import type { Movie } from '../../types';
import type { PlaybackSnapshot } from '../../lib/playbackState';
import { expectedPosition, decideCorrection, decideYouTubeCorrection, compensatePublishPosition, HOST_REPUBLISH_MS } from '../../lib/playbackService';
import { YouTubeMedia, youTubeErrorMessage, type PlayableMedia } from '../../lib/youtubeMedia';
import { RollingStats, type StatsSummary } from '../../lib/syncStats';

declare global {
  interface Window {
    /** Live sync measurements of this viewer (see src/lib/syncStats.ts) */
    watchPartySync?: { latencyMs: StatsSummary | null; driftMs: StatsSummary | null };
  }
}

/** Shared-playback wiring for real (Supabase) rooms. */
export interface PlaybackSyncProps {
  /** The room's shared state (null until the host first plays) */
  playback: PlaybackSnapshot | null;
  /** Server clock minus local clock, in ms */
  clockOffsetMs: number;
  /** Host only: publish a new shared state */
  onHostChange: (state: { isPlaying: boolean; position: number }) => void;
  /** Estimated one-way delay to the server in ms (host compensates for it) */
  serverDelayMs?: number;
}

interface VideoPlayerProps {
  movie: Movie;
  isHost: boolean;
  room: { id: string; code: string } | null;
  currentUser: { id: string; name: string; isHost: boolean };
  driftMs: number;
  onSimulateDrift: () => void;
  /** Present in real rooms: enables synchronized playback */
  sync?: PlaybackSyncProps;
}

/**
 * Formats seconds into MM:SS format
 */
function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** How often viewers compare their player with the shared timeline */
const FOLLOWER_CHECK_MS = 1000;
/** How often the host checks it has not drifted from what it published */
const HOST_CHECK_MS = 5000;

export function VideoPlayer({ movie, isHost, currentUser, driftMs, onSimulateDrift, sync }: VideoPlayerProps) {
  // The media being controlled: a <video> element, or the YouTube adapter
  // (same interface, see src/lib/youtubeMedia.ts)
  const videoRef = useRef<PlayableMedia | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isYouTube = movie.source === 'youtube' && Boolean(movie.youtubeId);
  /** Empty element the YouTube adapter puts its iframe into */
  const youTubeHostRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // --- Video sources: primary first, then backups if it fails ---
  // Both values below are tied to a movie id, so switching movies
  // starts fresh from the primary source without needing an effect.
  const sources = [movie.videoUrl, ...(movie.fallbackVideoUrls ?? [])];
  const [sourceState, setSourceState] = useState({ movieId: movie.id, index: 0 });
  const sourceIndex = sourceState.movieId === movie.id ? Math.min(sourceState.index, sources.length - 1) : 0;
  const [failure, setFailure] = useState<{ movieId: string; reason: string } | null>(null);
  const hasError = failure?.movieId === movie.id;
  /** Position to resume at after switching to a backup source */
  const resumeAtRef = useRef<number | null>(null);

  // --- Synchronized playback state (real rooms only) ---
  const isSynced = Boolean(sync);
  const playback = sync?.playback ?? null;
  const clockOffsetMs = sync?.clockOffsetMs ?? 0;
  // The parent passes a new function each render; keep the latest in a
  // ref so timers below are not restarted on every render.
  const onHostChangeRef = useRef(sync?.onHostChange);
  const serverDelayRef = useRef(sync?.serverDelayMs ?? 0);
  useEffect(() => {
    onHostChangeRef.current = sync?.onHostChange;
    serverDelayRef.current = sync?.serverDelayMs ?? 0;
  });

  /** Browser blocked autoplay: the viewer must click once to join */
  const [needsGesture, setNeedsGesture] = useState(false);
  /** Measured drift shown in the HUD (ms, local − expected) */
  const [measuredDriftMs, setMeasuredDriftMs] = useState<number | null>(null);
  // Sync quality measurements (viewers only)
  const [syncStats] = useState(() => ({ latency: new RollingStats(), drift: new RollingStats() }));
  const [statsTitle, setStatsTitle] = useState('');
  const lastLatencyVersionRef = useRef(-1);
  const [hint, setHint] = useState<string | null>(null);
  const driftRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const lastHostAppliedVersionRef = useRef<number>(-1);
  const seekPublishTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // --- Local control (host, or anyone in a demo room) ---
  // The player follows what the user ASKED for ("intent"), not whatever
  // state the <video> element happens to be in. Seeking, buffering, a
  // source switch or a reload can leave the element paused or stalled;
  // ensureIntent() brings it back in line, and guests are always sent
  // the intent, so host and guests cannot disagree.
  const controlsAreLocal = !isSynced || isHost;
  const [wantsPlaying, setWantsPlaying] = useState(false);
  const wantsPlayingRef = useRef(false);
  const setIntent = useCallback((playing: boolean) => {
    wantsPlayingRef.current = playing;
    setWantsPlaying(playing);
  }, []);
  /** Set while the element is (re)loading a source: pauses then are expected */
  const reloadingRef = useRef(true);
  /** pause() / play() calls made by this component (vs. media keys etc.) */
  const ourPauseRef = useRef(false);
  const ourPlayRef = useRef(false);
  const playPendingRef = useRef(false);
  // Latest values for timers and event handlers
  const controlsAreLocalRef = useRef(controlsAreLocal);
  const hasErrorRef = useRef(hasError);
  const syncedHostRef = useRef(isSynced && isHost);
  useEffect(() => {
    controlsAreLocalRef.current = controlsAreLocal;
    hasErrorRef.current = hasError;
    syncedHostRef.current = isSynced && isHost;
  });

  // Progress bar: while dragging only the bar moves; the video seeks once
  // on release (one network request instead of one per pixel).
  const scrubbingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const showHint = useCallback((text: string) => {
    setHint(text);
    setTimeout(() => setHint(null), 2200);
  }, []);

  /** Host only: send the intended state to everyone */
  const publishState = useCallback((playing: boolean, position?: number) => {
    const video = videoRef.current;
    if (!syncedHostRef.current || !video) return;
    clearTimeout(seekPublishTimerRef.current);
    const at = position ?? video.currentTime;
    onHostChangeRef.current?.({ isPlaying: playing, position: compensatePublishPosition(at, playing, serverDelayRef.current) });
  }, []);

  const playLocal = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.paused || playPendingRef.current) return;
    ourPlayRef.current = true;
    playPendingRef.current = true;
    video.play().then(
      () => {
        playPendingRef.current = false;
      },
      (err: unknown) => {
        playPendingRef.current = false;
        ourPlayRef.current = false;
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError') {
          // The browser refused (no user gesture yet): stay honest with guests
          setIntent(false);
          publishState(false);
          setHint('The browser blocked playback — press Play again');
          setTimeout(() => setHint(null), 2200);
        }
        // AbortError (interrupted by a seek or a new source) and source
        // errors need nothing here: ensureIntent() retries once the video
        // can play, and failed sources are handled by handleVideoError.
      }
    );
  }, [publishState, setIntent]);

  const pauseLocal = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;
    ourPauseRef.current = true;
    video.pause();
  }, []);

  /** Makes the <video> element match the user's intent (local control only) */
  const ensureIntent = useCallback(() => {
    const video = videoRef.current;
    if (!controlsAreLocalRef.current || !video || hasErrorRef.current || reloadingRef.current) return;
    if (wantsPlayingRef.current) {
      if (video.paused && !video.ended) playLocal();
    } else {
      pauseLocal();
    }
  }, [playLocal, pauseLocal]);

  // Safety net: re-check every second that the player is doing what was asked
  useEffect(() => {
    if (!controlsAreLocal) return;
    const timer = setInterval(ensureIntent, 1000);
    return () => clearInterval(timer);
  }, [controlsAreLocal, ensureIntent]);

  /**
   * Moves the local player onto the shared timeline.
   * Viewers call this continuously; the host only when adopting a state
   * someone else published (e.g. right after becoming host or rejoining).
   */
  const reconcile = useCallback((force = false) => {
    const video = videoRef.current;
    if (!video || !playback || playback.movieId !== movie.id) return;
    if (video.readyState < 1) return; // metadata not loaded yet

    const expected = expectedPosition(playback, Date.now() + clockOffsetMs, video.duration);

    if (playback.isPlaying && video.paused && !video.ended) {
      video.play().then(
        () => setNeedsGesture(false),
        (err: unknown) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') setNeedsGesture(true);
        }
      );
    } else if (!playback.isPlaying && !video.paused) {
      video.pause();
    }

    // Never fight the network while the player is buffering
    if (bufferingRef.current && !force) return;

    const drift = (video.currentTime - expected) * 1000;
    driftRef.current = Math.round(drift);
    if (playback.isPlaying) syncStats.drift.add(Math.abs(drift));
    const forceLimit = isYouTube ? 500 : 100;
    const decision = force && Math.abs(drift) > forceLimit
      ? { kind: 'seek' as const }
      : isYouTube ? decideYouTubeCorrection(drift, playback.isPlaying) : decideCorrection(drift, playback.isPlaying);
    if (decision.kind === 'seek') {
      video.currentTime = expected;
      video.playbackRate = 1;
    } else if (decision.kind === 'rate') {
      video.playbackRate = decision.rate;
    } else if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }
  }, [playback, movie.id, clockOffsetMs, syncStats, isYouTube]);

  // Viewers: measure how long each host change took to arrive here
  useEffect(() => {
    if (!isSynced || isHost || !playback) return;
    if (playback.version <= lastLatencyVersionRef.current) return;
    const isFirst = lastLatencyVersionRef.current === -1;
    lastLatencyVersionRef.current = playback.version;
    if (isFirst) return; // the state found on joining is not a live update
    const latency = Date.now() + clockOffsetMs - playback.updatedAtMs;
    if (latency >= 0 && latency < 60_000) syncStats.latency.add(latency);
  }, [isSynced, isHost, playback, clockOffsetMs, syncStats]);

  // Viewers: follow every new shared state immediately, then keep checking.
  useEffect(() => {
    if (!isSynced || isHost) return;
    reconcile();
    const timer = setInterval(() => reconcile(), FOLLOWER_CHECK_MS);
    return () => clearInterval(timer);
  }, [isSynced, isHost, reconcile]);

  /**
   * Host: take over a shared state as the local intent (used when the
   * player (re)loads, or when someone else published the state).
   */
  const adoptSnapshot = useCallback((snapshot: PlaybackSnapshot) => {
    const video = videoRef.current;
    if (!video || snapshot.movieId !== movie.id || video.readyState < 1) return;
    const expected = expectedPosition(snapshot, Date.now() + clockOffsetMs, video.duration);
    if (Math.abs(video.currentTime - expected) > 0.25) video.currentTime = expected;
    setIntent(snapshot.isPlaying);
    ensureIntent();
  }, [movie.id, clockOffsetMs, setIntent, ensureIntent]);

  // Host: adopt shared states published by someone else (previous host,
  // own earlier session) once; the host's own updates are never re-applied,
  // so local and remote state cannot feed back into each other.
  useEffect(() => {
    if (!isSynced || !isHost || !playback) return;
    if (playback.version <= lastHostAppliedVersionRef.current) return;
    lastHostAppliedVersionRef.current = playback.version;
    if (playback.updatedBy !== currentUser.id) adoptSnapshot(playback);
  }, [isSynced, isHost, playback, currentUser.id, adoptSnapshot]);

  // Host: if the local player drifts from what was published (buffering,
  // slow device), publish the real position so viewers follow the host.
  useEffect(() => {
    if (!isSynced || !isHost) return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || !playback || playback.movieId !== movie.id || bufferingRef.current) return;
      if (!wantsPlayingRef.current || video.paused || video.seeking) return;
      const expected = expectedPosition(playback, Date.now() + clockOffsetMs, video.duration);
      if (Math.abs(video.currentTime - expected) * 1000 > HOST_REPUBLISH_MS) {
        publishState(true, video.currentTime);
      }
    }, HOST_CHECK_MS);
    return () => clearInterval(timer);
  }, [isSynced, isHost, playback, movie.id, clockOffsetMs, publishState]);

  // Refresh the drift readout once per second
  useEffect(() => {
    if (!isSynced) return;
    const timer = setInterval(() => {
      setMeasuredDriftMs(driftRef.current);
      const latency = syncStats.latency.summary();
      const drift = syncStats.drift.summary();
      window.watchPartySync = { latencyMs: latency, driftMs: drift };
      setStatsTitle(
        (latency ? ` • update delay p50 ${latency.p50} ms / p95 ${latency.p95} ms (${latency.count})` : '') +
        (drift ? ` • drift p95 ${drift.p95} ms` : '')
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [isSynced, syncStats]);

  // Reload the video element when the movie changes (YouTube players are
  // re-created per video instead; see the YouTube effect below)
  useEffect(() => {
    if (!isYouTube) videoRef.current?.load();
  }, [movie.id, isYouTube]);

  // --- Playback Controls ---

  /** Viewers who are blocked by autoplay rules join with one click */
  const joinPlayback = () => {
    setNeedsGesture(false);
    videoRef.current?.play().then(() => reconcile(true), () => setNeedsGesture(true));
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isSynced && !isHost) {
      if (needsGesture) joinPlayback();
      else showHint('Only the host controls playback');
      return;
    }

    // Decide from the intent (what the button shows), not video.paused:
    // a video that is buffering after a seek is "playing" but frozen.
    const next = !wantsPlayingRef.current;
    setIntent(next);
    if (next) {
      if (video.ended) video.currentTime = 0;
      playLocal();
    } else {
      pauseLocal();
    }
    publishState(next);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  /** Seek the local video; keeps playing if it was playing, paused if paused */
  const commitSeek = (time: number, { debouncePublish = false } = {}) => {
    const video = videoRef.current;
    scrubbingRef.current = false;
    pendingSeekRef.current = null;
    setScrubTime(null);
    if (!video || !Number.isFinite(time)) return;

    video.currentTime = time;
    setCurrentTime(time);
    ensureIntent();

    if (!syncedHostRef.current) return;
    clearTimeout(seekPublishTimerRef.current);
    if (debouncePublish) {
      // Keyboard arrows can repeat quickly: send only the final position
      seekPublishTimerRef.current = setTimeout(() => publishState(wantsPlayingRef.current, time), 250);
    } else {
      publishState(wantsPlayingRef.current, time);
    }
  };

  const seekLocked = () => {
    if (isSynced && !isHost) {
      showHint('Only the host controls playback');
      return true;
    }
    return false;
  };

  const handleScrubStart = () => {
    if (seekLocked()) return;
    scrubbingRef.current = true;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (seekLocked()) return;
    const newTime = parseFloat(e.target.value);
    if (scrubbingRef.current) {
      // Dragging: move the bar only; the video seeks on release
      pendingSeekRef.current = newTime;
      setScrubTime(newTime);
    } else {
      commitSeek(newTime, { debouncePublish: true });
    }
  };

  const handleScrubEnd = () => {
    if (!scrubbingRef.current) return;
    const target = pendingSeekRef.current;
    if (target === null) {
      // Pressed and released without moving
      scrubbingRef.current = false;
      setScrubTime(null);
      return;
    }
    commitSeek(target);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      setIsMuted(newVol === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      videoRef.current.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleRestart = () => {
    if (seekLocked()) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setIntent(true);
    playLocal();
    publishState(true, 0);
  };

  // --- Video element events ---

  const handleWaiting = () => {
    bufferingRef.current = true;
    setIsBuffering(true);
  };

  const handlePlay = () => {
    if (ourPlayRef.current) {
      ourPlayRef.current = false;
      return;
    }
    // Started from outside the app (media keys, picture-in-picture)
    if (controlsAreLocalRef.current && !wantsPlayingRef.current) {
      setIntent(true);
      publishState(true);
    }
  };

  const handlePlaying = () => {
    setIsPlaying(true);
    setIsBuffering(false);
    const wasBuffering = bufferingRef.current;
    bufferingRef.current = false;
    // Host recovered from buffering (e.g. after a seek): viewers kept
    // going meanwhile, so re-align them to where the host really is.
    if (wasBuffering && wantsPlayingRef.current) publishState(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
    setIsBuffering(false);
    bufferingRef.current = false;
    if (ourPauseRef.current) {
      ourPauseRef.current = false;
      return;
    }
    const video = videoRef.current;
    if (!controlsAreLocalRef.current || !video || !wantsPlayingRef.current) return;
    // Expected pauses (end of film, reload, seek, error) are handled
    // elsewhere; ensureIntent() resumes after reloads and seeks.
    if (video.ended || video.seeking || reloadingRef.current || hasErrorRef.current) return;
    // Paused from outside the app (media keys, picture-in-picture, system
    // media controls): follow it and tell the guests.
    setIntent(false);
    publishState(false);
  };

  const handleCanPlay = () => {
    // The video can continue: make sure it does what the user asked for
    ensureIntent();
  };

  const handleSeeked = () => {
    ensureIntent();
  };

  const handleEmptied = () => {
    // A new source is loading (movie change or backup source)
    reloadingRef.current = true;
    bufferingRef.current = false;
    setIsBuffering(false);
  };

  /** A source failed (e.g. 403/404, network, unsupported): try the next one */
  const handleVideoError = () => {
    const video = videoRef.current;
    const code = video?.error?.code;
    if (isYouTube) {
      // No backup sources for YouTube: explain what YouTube reported
      setFailure({ movieId: movie.id, reason: youTubeErrorMessage(code ?? -1) });
      setIsPlaying(false);
      return;
    }
    if (code === MediaError.MEDIA_ERR_ABORTED) return; // load was cancelled on purpose

    if (video && video.currentTime > 0) resumeAtRef.current = video.currentTime;
    if (sourceIndex + 1 < sources.length) {
      console.warn(`Video source ${sourceIndex + 1}/${sources.length} failed for "${movie.title}", trying a backup.`);
      setSourceState({ movieId: movie.id, index: sourceIndex + 1 });
      return;
    }

    const reason =
      code === MediaError.MEDIA_ERR_NETWORK ? 'a network error interrupted the download'
      : code === MediaError.MEDIA_ERR_DECODE ? 'the file could not be decoded'
      : 'the video server refused or could not find the file';
    setFailure({ movieId: movie.id, reason });
    setIsPlaying(false);
  };

  const retryFromFirstSource = () => {
    setFailure(null);
    if (sourceIndex === 0) {
      videoRef.current?.load();
    } else {
      setSourceState({ movieId: movie.id, index: 0 }); // new src reloads automatically
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    setDuration(video?.duration || 0);
    reloadingRef.current = false;
    if (!video) return;

    const resumeAt = resumeAtRef.current;
    resumeAtRef.current = null;

    if (isSynced && !isHost) {
      // Late join / movie change / backup source: jump onto the shared timeline
      reconcile(true);
    } else if (resumeAt !== null) {
      // Switched to a backup mid-film: continue from the same place,
      // playing or paused as before
      video.currentTime = resumeAt;
      ensureIntent();
    } else if (isSynced && playback) {
      // Host's player (re)loaded (movie change, refresh, coming back to
      // the room): pick up the shared state instead of starting at 0:00
      adoptSnapshot(playback);
    } else {
      ensureIntent();
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (!controlsAreLocal) return;
    setIntent(false);
    publishState(false);
  };

  // --- Drift Display ---
  const syncedDriftLabel = isHost
    ? 'Host clock'
    : measuredDriftMs === null
      ? 'Syncing…'
      : `${Math.abs(measuredDriftMs)}ms Drift`;

  const handleDriftClick = () => {
    if (!isSynced) {
      onSimulateDrift();
    } else if (isHost) {
      publishState(wantsPlayingRef.current);
      showHint('Position re-sent to everyone');
    } else {
      reconcile(true);
      showHint('Re-synced to host');
    }
  };

  /** Keyboard shortcuts while the player has focus */
  const handlePlayerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Buttons and sliders inside the player handle their own keys
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && (target.tagName === 'BUTTON' || target.tagName === 'INPUT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const video = videoRef.current;
    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        if (seekLocked() || !video) return;
        commitSeek(
          Math.min(Math.max(0, video.currentTime + (e.key === 'ArrowRight' ? 5 : -5)), video.duration || Infinity),
          { debouncePublish: true }
        );
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
    }
  };

  // --- YouTube: create the adapter and route its events to the same
  // handlers the <video> element uses ---
  const mediaHandlersRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    mediaHandlersRef.current = {
      timeupdate: handleTimeUpdate,
      play: handlePlay,
      playing: handlePlaying,
      pause: handlePause,
      waiting: handleWaiting,
      canplay: handleCanPlay,
      seeked: handleSeeked,
      emptied: handleEmptied,
      loadedmetadata: handleLoadedMetadata,
      durationchange: () => setDuration(videoRef.current?.duration || 0),
      ended: handleEnded,
      error: handleVideoError,
    };
  });
  const youtubeId = isYouTube ? movie.youtubeId! : null;
  useEffect(() => {
    const host = youTubeHostRef.current;
    if (!youtubeId || !host) return;
    const media = new YouTubeMedia(host, youtubeId);
    videoRef.current = media;
    const listeners = Object.keys(mediaHandlersRef.current).map((type) => {
      const listener = () => mediaHandlersRef.current[type]?.();
      media.addEventListener(type, listener);
      return [type, listener] as const;
    });
    return () => {
      for (const [type, listener] of listeners) media.removeEventListener(type, listener);
      media.destroy();
      if (videoRef.current === media) videoRef.current = null;
    };
  }, [youtubeId]);

  const controlsLocked = isSynced && !isHost;
  // Host / demo buttons show what was asked for; guests show what plays
  const showAsPlaying = controlsAreLocal ? wantsPlaying : isPlaying;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={`Video player: ${movie.title}. Keys: Space play or pause, arrows skip 5 seconds, M mute, F fullscreen`}
      tabIndex={0}
      onKeyDown={handlePlayerKeyDown}
      onFocus={() => setShowControls(true)}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      className="group relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[0.12] bg-black cinema-ambient-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      {/* Video Element (file) or YouTube player */}
      {isYouTube ? (
        <>
          <div ref={youTubeHostRef} className="h-full w-full bg-black [&>iframe]:h-full [&>iframe]:w-full" />
          {/* Clicks go to the app's controls, not into YouTube's player */}
          <div
            className="absolute inset-0 z-[5] cursor-pointer"
            onClick={togglePlay}
            aria-hidden="true"
          />
        </>
      ) : (
      <video
        ref={(el) => {
          if (!isYouTube) videoRef.current = el;
        }}
        src={sources[sourceIndex]}
        poster={movie.backdropUrl}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPlaying={handlePlaying}
        onPause={handlePause}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onSeeked={handleSeeked}
        onEmptied={handleEmptied}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onEnded={handleEnded}
        onError={handleVideoError}
        playsInline
        className="h-full w-full object-contain bg-black cursor-pointer"
        onClick={togglePlay}
      />
      )}

      {/* Fallback Display if video cannot load in preview */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center z-20 backdrop-blur-md">
          <AlertCircle className="h-10 w-10 text-amber-400" />
          <h4 className="mt-2 text-sm font-bold text-white">Video unavailable</h4>
          <p className="mt-1 max-w-sm text-xs text-slate-400">
            “{movie.title}” could not be loaded — {failure?.reason}
            {!isYouTube && sources.length > 1 ? ` (tried ${sources.length} sources)` : ''}.
            {isYouTube && failure?.reason && !/connection|blocker/.test(failure.reason)
              ? 'The host can choose another video'
              : 'Check your internet connection and try again'}
            {isSynced ? '. Chat, reactions and polls keep working meanwhile.' : '.'}
          </p>
          <button
            type="button"
            onClick={retryFromFirstSource}
            className="mt-4 rounded-xl border border-violet-500/30 bg-violet-600/20 px-4 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-600/30"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Top Floating Cinema HUD */}
      <div
        className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md">
            <span className="text-xs font-bold text-white tracking-wide">
              {movie.title}
            </span>
            <span className="text-white/20">•</span>
            <span className="text-[10px] text-slate-400 font-mono">
              {movie.category}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Host indicator - shows who controls playback */}
          <div
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md ${
              isHost
                ? 'border-violet-500/30 bg-violet-950/60 text-violet-200'
                : 'border-white/10 bg-black/60 text-slate-300'
            }`}
          >
            <Shield className="h-3 w-3 text-amber-400" />
            <span>{isHost ? 'Host Controls Active' : 'Synced to Host'}</span>
          </div>

          {/* Real-time Drift Meter */}
          <button
            type="button"
            onClick={handleDriftClick}
            title={isSynced ? `Click to re-sync now${statsTitle}` : 'Click to simulate network drift calibration'}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-black/60 px-3 py-1.5 text-[11px] font-mono text-emerald-300 backdrop-blur-md hover:bg-emerald-950/40 transition-colors"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </span>
            <span>{isSynced ? syncedDriftLabel : `${driftMs}ms Drift`}</span>
            <RefreshCw className="h-3 w-3 text-emerald-400 ml-1" />
          </button>
        </div>
      </div>

      {/* Viewer must click once when the browser blocks autoplay */}
      {needsGesture && !hasError && (
        <button
          type="button"
          onClick={joinPlayback}
          className="absolute inset-0 z-10 m-auto flex h-fit w-fit flex-col items-center gap-2 rounded-2xl border border-white/20 bg-black/70 px-6 py-5 text-white shadow-2xl backdrop-blur-md transition-all hover:border-violet-400/50 hover:bg-violet-600/40"
        >
          <Play className="h-8 w-8 fill-white" />
          <span className="text-xs font-semibold">The host is playing — click to join</span>
        </button>
      )}

      {/* Loading after a seek or a slow connection (not the same as paused) */}
      {isBuffering && showAsPlaying && !hasError && (
        <div
          className="pointer-events-none absolute inset-0 z-10 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 backdrop-blur-md"
          role="status"
          aria-label="Loading video"
        >
          <Loader2 className="h-7 w-7 animate-spin text-white" />
        </div>
      )}

      {/* Center Big Play Button (when paused) */}
      {!showAsPlaying && !hasError && !needsGesture && !controlsLocked && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 z-10 m-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur-md transition-all duration-300 hover:scale-110 hover:bg-violet-600/80 hover:border-violet-400/50"
        >
          <Play className="h-8 w-8 fill-white translate-x-0.5" />
        </button>
      )}

      {/* Short notices (e.g. "Only the host controls playback") */}
      {hint && (
        <div className="absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-lg border border-white/10 bg-black/80 px-3 py-1.5 text-[11px] font-semibold text-slate-200 backdrop-blur-md">
          {hint}
        </div>
      )}

      {/* Bottom Sleek Cinema Controls Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 z-20 flex flex-col gap-2 p-3 sm:p-5 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 ${
          showControls || !showAsPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Scrubber Progress Track */}
        <div className="relative flex items-center group/scrubber cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step="any"
            value={scrubTime ?? currentTime}
            onPointerDown={handleScrubStart}
            onChange={handleSeek}
            onPointerUp={handleScrubEnd}
            onPointerCancel={handleScrubEnd}
            onLostPointerCapture={handleScrubEnd}
            onBlur={handleScrubEnd}
            disabled={controlsLocked}
            aria-label="Seek"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/20 accent-violet-400 transition-all group-hover/scrubber:h-2 disabled:cursor-not-allowed"
          />
        </div>

        {/* Buttons and Time HUD */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded-lg p-1.5 text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              aria-label={showAsPlaying ? 'Pause' : 'Play'}
              disabled={controlsLocked && !needsGesture}
              title={controlsLocked ? 'Only the host controls playback' : undefined}
            >
              {showAsPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
            </button>

            <button
              type="button"
              onClick={handleRestart}
              className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              title={controlsLocked ? 'Only the host controls playback' : 'Restart from beginning'}
              aria-label="Restart video"
              disabled={controlsLocked}
            >
              <RotateCcw className="h-4 w-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4 text-red-400" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )
              }
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="h-1 w-14 sm:w-20 cursor-pointer appearance-none rounded-lg bg-white/20 accent-violet-400"
              />
            </div>

            {/* Time Stamp */}
            <span className="font-mono text-xs text-slate-300 tracking-wider">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
