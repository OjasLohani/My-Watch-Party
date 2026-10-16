import { useState, useRef, useEffect, useMemo } from 'react';
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
import { createPlaybackService, usePlaybackRealtime } from '../../lib/playbackService';

interface VideoPlayerProps {
  movie: Movie;
  isHost: boolean;
  room: { id: string; code: string } | null;
  currentUser: { id: string; name: string; isHost: boolean };
  driftMs: number;
  onSimulateDrift: () => void;
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

export function VideoPlayer({ movie, isHost, room, currentUser, driftMs, onSimulateDrift }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // --- Synchronized Playback State ---
  // Create the playback service using room ID, user ID, and host status
  const playbackService = useMemo(() => {
    if (!room || !currentUser) {
      // Fallback service without realtime if room/user not yet available
      return createPlaybackService('fallback-room', currentUser?.id || 'user-unknown', isHost);
    }
    return createPlaybackService(room.id, currentUser.id, isHost);
  }, [room, currentUser, isHost]);

  // Set the video element reference when the video mounts
  useEffect(() => {
    playbackService.setVideoElement(videoRef.current);
    // On mount, synchronize video from last known state in Supabase
    playbackService._synchronizeVideoFromState();
    // Start drift monitoring
    playbackService.startDriftMonitoring();
    return () => {
      playbackService.stopDriftMonitoring();
      playbackService.cleanup();
    };
  }, [playbackService]);

  // Set video ID when movie changes
  useEffect(() => {
    playbackService.setVideoId(movie.id);
    // Reset video position when movie changes
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    }
  }, [movie.id, playbackService]);

  // Apply playback commands received from other clients
  usePlaybackRealtime(playbackService, (command) => {
    // The service.applyCommand handles version checking internally
    const { type, payload } = command;

    switch (type) {
      case 'play':
        setIsPlaying(true);
        break;
      case 'pause':
        setIsPlaying(false);
        break;
      case 'seek':
        if (payload.currentTime !== undefined) {
          setCurrentTime(payload.currentTime);
          if (videoRef.current) {
            videoRef.current.currentTime = payload.currentTime;
          }
        }
        break;
      case 'video-change':
        if (payload.videoId) {
          // Could trigger movie switch; for now, update videoId
          playbackService.setVideoId(payload.videoId);
        }
        if (payload.isPlaying !== undefined) {
          setIsPlaying(payload.isPlaying);
        }
        break;
    }
  })();

  // Update local UI state from playback service state
  useEffect(() => {
    const state = playbackService.getLocalState();
    // Use setTimeout to avoid setState-in-effect warning;
    // the callback runs after the current render cycle completes.
    setTimeout(() => {
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
    }, 0);
  }, [playbackService]);

  // Sync currentTime from video element timeupdate
  useEffect(() => {
    if (!videoRef.current) return;

    const handleTimeUpdate = () => {
      setCurrentTime(videoRef.current.currentTime);
    };

    const handlePlaying = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleDurationUpdate = () => {
      setDuration(videoRef.current.duration || 0);
    };

    const handleError = () => {
      setHasError(true);
    };

    videoRef.current.addEventListener('timeupdate', handleTimeUpdate);
    videoRef.current.addEventListener('playing', handlePlaying);
    videoRef.current.addEventListener('pause', handlePause);
    videoRef.current.addEventListener('durationchange', handleDurationUpdate);
    videoRef.current.addEventListener('error', handleError);

    return () => {
      const video = videoRef.current;
      if (!video) return;

      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('durationchange', handleDurationUpdate);
      video.removeEventListener('error', handleError);
    };
  }, []);

  // --- Playback Controls ---

  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setHasError(true));
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
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
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // --- Drift Display ---
  const measuredDrift = playbackService.getDriftMs();

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
        src={movie.videoUrl}
        poster={movie.backdropUrl}
        onTimeUpdate={handleTimeUpdate}
        onPlaying={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => setHasError(true)}
        playsInline
        className="h-full w-full object-contain bg-black cursor-pointer"
        onClick={togglePlay}
      />

      {/* Fallback Display if video cannot load in preview */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center z-20 backdrop-blur-md">
          <AlertCircle className="h-10 w-10 text-amber-400" />
          <h4 className="mt-2 text-sm font-bold text-white">Browser Stream Playback</h4>
          <p className="mt-1 max-w-sm text-xs text-slate-400">
            Streaming open media stream. Click below to reconnect playback.
          </p>
          <button
            type="button"
            onClick={() => {
              setHasError(false);
              if (videoRef.current) {
                videoRef.current.load();
              }
            }}
            className="mt-4 rounded-xl border border-violet-500/30 bg-violet-600/20 px-4 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-600/30"
          >
            Retry Stream
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
            onClick={onSimulateDrift}
            title="Click to simulate network drift calibration"
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-black/60 px-3 py-1.5 text-[11px] font-mono text-emerald-300 backdrop-blur-md hover:bg-emerald-950/40 transition-colors"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </span>
            <span>{driftMs}ms Drift</span>
            <RefreshCw className="h-3 w-3 text-emerald-400 ml-1" />
          </button>
        </div>
      </div>

      {/* Center Big Play Button (when paused) */}
      {!isPlaying && !hasError && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 z-10 m-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur-md transition-all duration-300 hover:scale-110 hover:bg-violet-600/80 hover:border-violet-400/50"
        >
          <Play className="h-8 w-8 fill-white translate-x-0.5" />
        </button>
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
            value={currentTime}
            onChange={handleSeek}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/20 accent-violet-400 transition-all group-hover/scrubber:h-2"
          />
        </div>

        {/* Buttons and Time HUD */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded-lg p-1.5 text-white hover:bg-white/10 transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
            </button>

            <button
              type="button"
              onClick={handleRestart}
              className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Restart from beginning"
              aria-label="Restart video"
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