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
  RefreshCw
} from 'lucide-react';
import type { Movie } from '../../types';
import type { PlaybackSnapshot } from '../../lib/playbackState';
import { expectedPosition, decideCorrection, HOST_REPUBLISH_MS } from '../../lib/playbackService';

/** Shared-playback wiring for real (Supabase) rooms. */
export interface PlaybackSyncProps {
  /** The room's shared state (null until the host first plays) */
  playback: PlaybackSnapshot | null;
  /** Server clock minus local clock, in ms */
  clockOffsetMs: number;
  /** Host only: publish a new shared state */
  onHostChange: (state: { isPlaying: boolean; position: number }) => void;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    onHostChangeRef.current = sync?.onHostChange;
  });

  /** Browser blocked autoplay: the viewer must click once to join */
  const [needsGesture, setNeedsGesture] = useState(false);
  /** Measured drift shown in the HUD (ms, local − expected) */
  const [measuredDriftMs, setMeasuredDriftMs] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const driftRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const lastHostAppliedVersionRef = useRef<number>(-1);
  const seekPublishTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showHint = useCallback((text: string) => {
    setHint(text);
    setTimeout(() => setHint(null), 2200);
  }, []);

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
    const decision = force && Math.abs(drift) > 100 ? { kind: 'seek' as const } : decideCorrection(drift, playback.isPlaying);
    if (decision.kind === 'seek') {
      video.currentTime = expected;
      video.playbackRate = 1;
    } else if (decision.kind === 'rate') {
      video.playbackRate = decision.rate;
    } else if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }
  }, [playback, movie.id, clockOffsetMs]);

  // Viewers: follow every new shared state immediately, then keep checking.
  useEffect(() => {
    if (!isSynced || isHost) return;
    reconcile();
    const timer = setInterval(() => reconcile(), FOLLOWER_CHECK_MS);
    return () => clearInterval(timer);
  }, [isSynced, isHost, reconcile]);

  // Host: adopt shared states published by someone else (previous host,
  // own earlier session) once, without fighting local control afterwards.
  useEffect(() => {
    if (!isSynced || !isHost || !playback) return;
    if (playback.version <= lastHostAppliedVersionRef.current) return;
    lastHostAppliedVersionRef.current = playback.version;
    if (playback.updatedBy !== currentUser.id) reconcile(true);
  }, [isSynced, isHost, playback, currentUser.id, reconcile]);

  // Host: if the local player drifts from what was published (buffering,
  // slow device), publish the real position so viewers follow the host.
  useEffect(() => {
    if (!isSynced || !isHost) return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || !playback || playback.movieId !== movie.id || bufferingRef.current || video.paused) return;
      const expected = expectedPosition(playback, Date.now() + clockOffsetMs, video.duration);
      if (Math.abs(video.currentTime - expected) * 1000 > HOST_REPUBLISH_MS) {
        onHostChangeRef.current?.({ isPlaying: true, position: video.currentTime });
      }
    }, HOST_CHECK_MS);
    return () => clearInterval(timer);
  }, [isSynced, isHost, playback, movie.id, clockOffsetMs]);

  // Refresh the drift readout once per second
  useEffect(() => {
    if (!isSynced) return;
    const timer = setInterval(() => setMeasuredDriftMs(driftRef.current), 1000);
    return () => clearInterval(timer);
  }, [isSynced]);

  // Reload the video element when the movie changes
  useEffect(() => {
    videoRef.current?.load();
  }, [movie.id]);

  // --- Playback Controls ---

  const publish = (playing: boolean) => {
    const video = videoRef.current;
    if (video) onHostChangeRef.current?.({ isPlaying: playing, position: video.currentTime });
  };

  /** Viewers who are blocked by autoplay rules join with one click */
  const joinPlayback = () => {
    setNeedsGesture(false);
    videoRef.current?.play().then(() => reconcile(true), () => setNeedsGesture(true));
  };

  const togglePlay = () => {
    if (!videoRef.current) return;

    if (isSynced && !isHost) {
      if (needsGesture) joinPlayback();
      else showHint('Only the host controls playback');
      return;
    }

    if (videoRef.current.paused) {
      // A failed source is reported by the video's error event (handled
      // below), so a rejected play() needs no extra handling here.
      videoRef.current.play().then(() => {
        setIsPlaying(true);
        if (isSynced) publish(true);
      }).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      if (isSynced) publish(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isSynced && !isHost) {
      showHint('Only the host controls playback');
      return;
    }
    const newTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
    if (isSynced) {
      // Dragging fires many events: publish once the scrubber settles
      clearTimeout(seekPublishTimerRef.current);
      seekPublishTimerRef.current = setTimeout(() => publish(!videoRef.current?.paused), 250);
    }
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
    if (isSynced && !isHost) {
      showHint('Only the host controls playback');
      return;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().then(() => {
        setIsPlaying(true);
        if (isSynced) publish(true);
      }).catch(() => {});
    }
  };

  // --- Video element events ---

  const handleWaiting = () => {
    bufferingRef.current = true;
  };

  const handlePlaying = () => {
    setIsPlaying(true);
    const wasBuffering = bufferingRef.current;
    bufferingRef.current = false;
    // Host recovered from buffering: viewers kept going, so re-align them
    if (isSynced && isHost && wasBuffering) publish(true);
  };

  const handleCanPlay = () => {
    bufferingRef.current = false;
  };

  /** A source failed (e.g. 403/404, network, unsupported): try the next one */
  const handleVideoError = () => {
    const video = videoRef.current;
    const code = video?.error?.code;
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
    setDuration(videoRef.current?.duration || 0);
    // Switched to a backup mid-film: continue from the same place
    const resumeAt = resumeAtRef.current;
    resumeAtRef.current = null;
    if (resumeAt !== null && !isSynced && videoRef.current) videoRef.current.currentTime = resumeAt;
    // Late join / movie change: jump straight onto the shared timeline
    if (isSynced && (!isHost || (playback && playback.updatedBy !== currentUser.id))) reconcile(true);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (isSynced && isHost) publish(false);
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
      publish(!videoRef.current?.paused);
      showHint('Position re-sent to everyone');
    } else {
      reconcile(true);
      showHint('Re-synced to host');
    }
  };

  const controlsLocked = isSynced && !isHost;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      className="group relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[0.12] bg-black cinema-ambient-glow"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={sources[sourceIndex]}
        poster={movie.backdropUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onPlaying={handlePlaying}
        onPause={() => setIsPlaying(false)}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onEnded={handleEnded}
        onError={handleVideoError}
        playsInline
        className="h-full w-full object-contain bg-black cursor-pointer"
        onClick={togglePlay}
      />

      {/* Fallback Display if video cannot load in preview */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center z-20 backdrop-blur-md">
          <AlertCircle className="h-10 w-10 text-amber-400" />
          <h4 className="mt-2 text-sm font-bold text-white">Video unavailable</h4>
          <p className="mt-1 max-w-sm text-xs text-slate-400">
            “{movie.title}” could not be loaded — {failure?.reason}
            {sources.length > 1 ? ` (tried ${sources.length} sources)` : ''}.
            Check your internet connection and try again
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
            title={isSynced ? 'Click to re-sync now' : 'Click to simulate network drift calibration'}
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

      {/* Center Big Play Button (when paused) */}
      {!isPlaying && !hasError && !needsGesture && !controlsLocked && (
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
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Scrubber Progress Track */}
        <div className="relative flex items-center group/scrubber cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step="any"
            value={currentTime}
            onChange={handleSeek}
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
              aria-label={isPlaying ? 'Pause' : 'Play'}
              disabled={controlsLocked && !needsGesture}
              title={controlsLocked ? 'Only the host controls playback' : undefined}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
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
