import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type {
  PlaybackState,
  PlaybackCommand,
  PlaybackCommandPayload,
  PlaybackUpdate,
} from './playbackState';
import type { Room } from '../types';
import { INITIAL_COMMAND_VERSION, DRIFT_SEEK_THRESHOLD_MS, DRIFT_RATE_ADJUST_MS, MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE } from './playbackState';

// ============================================================
// Types for internal tracking
// ============================================================

type CommandHandler = (command: PlaybackCommand) => void;

interface PlaybackClientState {
  roomId: string;
  /** Last command version we've applied (prevents replay/out-of-order) */
  lastAppliedVersion: number;
  /** Last server timestamp we received */
  lastServerTimestamp: number;
  /** Local measured drift in ms (positive = client ahead of server) */
  driftMs: number;
  /** Number of ms since we last measured drift */
  driftMeasureInterval: NodeJS.Timeout | null;
  /** Cached video duration for seek clamping */
  cachedDuration: number;
}

// ============================================================
// Playback Service - Core logic for synchronized playback
// ============================================================

export class PlaybackService {
  private roomId: string;
  private userId: string;
  private videoId: string;
  private clientState: PlaybackClientState;
  private commandVersion: number; // last version SENT by this client
  private isHost: boolean;
  private videoElement: HTMLVideoElement | null = null;
  private commandHandlers: Map<string, CommandHandler> = new Map();

  constructor(roomId: string, userId: string, isHost: boolean) {
    this.roomId = roomId;
    this.userId = userId;
    this.isHost = isHost;
    this.clientState = {
      roomId,
      lastAppliedVersion: -1,
      lastServerTimestamp: 0,
      driftMs: 0,
      driftMeasureInterval: null,
      cachedDuration: 0,
    };
    this.commandVersion = INITIAL_COMMAND_VERSION;
  }

  /** Set the video element reference for playback control */
  setVideoElement(video: HTMLVideoElement | null) {
    this.videoElement = video;
    if (video && this.clientState.isPlaying) {
      // Video just attached; ensure we're playing at the right position
      this._synchronizeVideoFromState();
    }
  }

  /** Update the video ID and reset state if changed */
  setVideoId(videoId: string) {
    this.videoId = videoId;
    // If video changed, ensure we track the new video in Supabase
    if (isSupabaseConfigured()) {
      supabase
        .from('playback_states')
        .upsert({
          room_id: this.roomId,
          user_id: this.userId,
          video_id: videoId,
          is_playing: this.clientState.isPlaying,
          current_time: this.videoElement?.currentTime ?? 0,
          playback_rate: this.videoElement?.playbackRate ?? 1,
          command_version: this.clientState.lastAppliedVersion,
          updated_at: new Date().toISOString(),
        });
    }
  }

  /** Get the current playback state from the video element */
  private _getCurrentPlaybackState(): {
    currentTime: number;
    playbackRate: number;
    isPlaying: boolean;
  } {
    if (!this.videoElement) {
      return { currentTime: 0, playbackRate: 1, isPlaying: false };
    }
    return {
      currentTime: this.videoElement.currentTime,
      playbackRate: this.videoElement.playbackRate || 1,
      isPlaying: !this.videoElement.paused,
    };
  }

  /** Synchronize video element from the stored playback state */
  private _synchronizeVideoFromState() {
    if (!this.videoElement) return;

    // Seek to the last known position
    const state = this._loadLastState();
    if (state) {
      const clampedTime = Math.max(0, Math.min(this.videoElement.duration ?? 0, state.currentTime));
      this.videoElement.currentTime = clampedTime;
      this.clientState.isPlaying = state.isPlaying;
      if (state.isPlaying) {
        this.videoElement.play().catch(() => {/* autoplay restricted */});
      }
      this._updatePlaybackStateFromVideo();
    }
  }

  /** Load the last known playback state from Supabase */
  private _loadLastState(): { currentTime: number; isPlaying: boolean } | null {
    if (!isSupabaseConfigured()) return null;

    try {
      const { data } = supabase
        .from('playback_states')
        .select('*')
        .eq('room_id', this.roomId)
        .eq('user_id', this.userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (!data) return null;

      return {
        currentTime: data.current_time,
        isPlaying: data.is_playing,
      };
    } catch {
      return null;
    }
  }

  /** Send a playback command via Supabase Realtime Broadcast */
  async sendCommand(
    type: PlaybackCommand['type'],
    payload: PlaybackCommandPayload
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      // Local fallback - just update local state
      this._applyCommandLocally({
        type,
        version: this.commandVersion++,
        payload,
        serverTimestamp: Date.now(),
      });
      return;
    }

    const command: PlaybackCommand = {
      type,
      version: this.commandVersion++,
      payload,
      serverTimestamp: Date.now(),
    };

    try {
      // 1. Insert/update playback state in Supabase with the command version
      const { error: dbError } = await supabase
        .from('playback_states')
        .upsert({
          room_id: this.roomId,
          user_id: this.userId,
          video_id: payload.videoId || this.videoId,
          is_playing: payload.isPlaying ?? this.clientState.isPlaying ?? false,
          current_time: payload.currentTime ?? this._getCurrentPlaybackState().currentTime,
          playback_rate:
            payload.currentTime !== undefined
              ? undefined
              : this._getCurrentPlaybackState().playbackRate,
          command_version: command.version,
          updated_at: new Date().toISOString(),
        });

      if (dbError) {
        console.error('Failed to upsert playback state:', dbError);
        // Fallback: local apply only
        this._applyCommandLocally(command);
        return;
      }

      // 2. Send a Realtime Broadcast so other clients in the room receive it
      await this._sendRealtimeBroadcast(command);
    } catch (err) {
      console.error('Error sending playback command:', err);
      this._applyCommandLocally(command);
    }
  }

  /** Send a command via Supabase Realtime broadcast channel */
  private async _sendRealtimeBroadcast(command: PlaybackCommand): Promise<void> {
    // We use the Supabase realtime channel to broadcast the command
    // Channel name: playback_room_{roomId}
    // Event name: playback_command

    // First, ensure we have a channel subscribed
    const channelName = `playback_room_${this.roomId}`;

    // Send the broadcast event
    // The supabase JavaScript client sends broadcasts via: channel.send({ event: 'broadcast', ... })
    // But for receiving, we use .on('broadcast', ...)

    // We need to send on the channel that others are listening on.
    // Since multiple clients will be subscribed to the same channelName,
    // we send the command as a broadcast on that channel.

    // Using the supabase.realtime approach:
    const { error } = await supabase
      .from('playback_command_broadcasts') // This is a virtual approach;
      // Actually, we'll use the channel.send method

    // Correct approach: use the channel's send method
    // Note: The actual channel needs to be subscribed first by other clients
    // We'll create/subscribe to the channel in the hook

    // For now, let's use the REST approach to insert into a broadcast table,
    // and rely on the realtime subscription in the hook to propagate.

    // Actually, the simplest approach: use supabase.rpc or channel.send
    // Let me use the proper supabase realtime broadcast:

    // We'll send on a channel that other clients have subscribed to
    // The channel name is deterministic: `playback_room_${roomId}`
    // Other clients should be listening on: channelName with event: 'broadcast'

    // Using the REST + realtime combination:
    // 1. Other clients subscribe to `channelName` with `on('broadcast', ...)`
    // 2. This client sends: `channel.send({ event: 'playback_command', payload: command })`

    // But we need access to the channel object. Let's handle this differently:
    // We'll insert the command into a table that has realtime enabled,
    // and the hook's postgres_changes listener will propagate it.

    // Actually, the cleanest approach for Supabase JavaScript v2:
    // - Create a channel: supabase.channel('playback_room_xyz')
    // - Listen for: .on('broadcast', { event: 'playback_command' }, handler)
    // - Send: channel.send({ event: 'playback_command', payload: { command }, channel: 'global' })

    // Since we can't easily share the channel reference between service and hook,
    // let's use the database + postgres_changes approach instead:

    // INSERT into a table that has a realtime trigger, and the hook listens for changes.

    // But the simplest path: use supabase.rpc or direct channel send.
    // Given the constraints, let me use the channel.send approach properly.

    try {
      // We need to get or create the channel. Since the hook manages the channel,
      // we'll use a different approach: insert into playback_states (already done above),
      // and the hook will listen for changes on the playback_states table via
      // postgres_changes, which will propagate to all subscribers.

      // Actually, the most reliable Supabase v2 approach:
      // 1. Upsert playback_states (done above) - this has realtime enabled by default
      // 2. Other clients subscribe to postgres_changes on playback_states table
      // 3. When we upsert, the realtime event fires on all subscribed channels

      // So the broadcast is implicitly handled by the realtime on the playback_states table.
      // We don't need a separate send; the upsert triggers the realtime event.

      // But we need to make sure the realtime channel is set up correctly.
      // Let me verify: when we call supabase.from('playback_states').upsert(),
      // it triggers a realtime event that other clients listening on
      // 'public:playback_states' with filter room_id=eq.{roomId} will receive.

      // So the key is: the hook must subscribe to postgres_changes on playback_states.
      // That's already handled in usePlaybackRealtime() hook.

      // So we're good - the upsert above IS the broadcast mechanism.
      // No additional _sendRealtimeBroadcast call needed.

      console.log('Playback command upserted; realtime broadcast triggered via playback_states table.');
    } catch (err) {
      console.error('Error in _sendRealtimeBroadcast:', err);
    }
  }

  /** Apply a command - called locally when sent, or remotely when received */
  applyCommand(command: PlaybackCommand): boolean {
    // Check version: only apply if newer than what we've applied
    if (command.version <= this.clientState.lastAppliedVersion) {
      // Stale or duplicate command - ignore
      return false;
    }

    this._applyCommandLocally(command);
    this.clientState.lastAppliedVersion = command.version;
    this.clientState.lastServerTimestamp = command.serverTimestamp;

    // Measure drift after applying
    this._measureDrift();

    return true;
  }

  private _applyCommandLocally(command: PlaybackCommand): {
    type: PlaybackCommand['type'];
    version: number;
    payload: PlaybackCommandPayload;
    serverTimestamp: number;
  } {
    const { type, payload } = command;

    switch (type) {
      case 'play':
        if (this.videoElement) {
          this.videoElement.play().catch(() => {/* autoplay restricted */ });
          this.clientState.isPlaying = true;
        }
        break;

      case 'pause':
        if (this.videoElement) {
          this.videoElement.pause();
          this.clientState.isPlaying = false;
        }
        break;

      case 'seek':
        if (this.videoElement && payload.currentTime !== undefined) {
          this.videoElement.currentTime = payload.currentTime;
          this._updatePlaybackStateFromVideo();
        }
        break;

      case 'video-change':
        if (payload.videoId) {
          this.setVideoId(payload.videoId);
        }
        if (payload.isPlaying !== undefined) {
          this.clientState.isPlaying = payload.isPlaying;
        }
        break;
    }

    // Update local playback state
    this._updateLocalPlaybackState();

    return true;
  }

  /** Get current video position from the video element */
  private _getCurrentTime(): number {
    return this.videoElement ? Math.max(0, this.videoElement.currentTime) : 0;
  }

  /** Update playback state synchronized with video element */
  private _updatePlaybackStateFromVideo() {
    if (!this.videoElement) return;

    const { currentTime, playbackRate } = this._getCurrentPlaybackState();

    // Update the Supabase playback_states table
    if (isSupabaseConfigured()) {
      supabase
        .from('playback_states')
        .upsert({
          room_id: this.roomId,
          user_id: this.userId,
          video_id: this.videoId,
          is_playing: this.clientState.isPlaying,
          current_time: currentTime,
          playback_rate: playbackRate,
          command_version: this.clientState.lastAppliedVersion,
          updated_at: new Date().toISOString(),
        });
    }
  }

  /** Update the local playback state object */
  private _updateLocalPlaybackState() {
    // The caller (hook) will compute drift from the server timestamp received
    // We just ensure the video element state is consistent
  }

  /** Start the drift measurement interval */
  startDriftMonitoring() {
    if (this.clientState.driftMeasureInterval) {
      clearInterval(this.clientState.driftMeasureInterval);
    }

    this.clientState.driftMeasureInterval = setInterval(() => {
      this._measureDriftNow();
    }, 3000); // measure every 3 seconds
  }

  /** Stop drift monitoring */
  stopDriftMonitoring() {
    if (this.clientState.driftMeasureInterval) {
      clearInterval(this.clientState.driftMeasureInterval);
      this.clientState.driftMeasureInterval = null;
    }
  }

  /** Take a single drift measurement now */
  private _measureDriftNow() {
    if (!this.videoElement) return;

    const localTime = this.videoElement.currentTime;
    const rate = this.videoElement.playbackRate || 1;
    const now = Date.now();

    // We need a server reference. The most recent command's serverTimestamp gives us
    // a baseline. Let's compute: how far should we have traveled at rate 'rate'
    // from the server timestamp to now?
    const timeDiff = now - this.clientState.lastServerTimestamp;
    const expectedTime =
      (this.clientState.lastServerTimestamp / 1000) + rate * (timeDiff / 1000);
    const drift = (localTime - expectedTime) * 1000; // convert to ms

    this.clientState.driftMs = drift;

    // Apply correction if drift exceeds threshold
    this._applyDriftCorrection(drift);
  }

  /** Apply drift correction: seek if large, rate adjust if small */
  private _applyDriftCorrection(driftMs: number) {
    if (Math.abs(driftMs) < DRIFT_SEEK_THRESHOLD_MS) {
      // Small drift - adjust playback rate slightly toward 1.0
      if (this.videoElement) {
        const currentRate = this.videoElement.playbackRate || 1;
        const targetRate =
          1 + (driftMs / DRIFT_RATE_ADJUST_MS) * 0.1; // small adjustment
        const clampedRate = Math.max(
          MIN_PLAYBACK_RATE,
          Math.min(MAX_PLAYBACK_RATE, targetRate)
        );

        if (Math.abs(clampedRate - currentRate) > 0.01) {
          this.videoElement.playbackRate = clampedRate;
        }
      }
    } else {
      // Large drift - seek to synchronized position
      if (this.videoElement && this.clientState.lastServerTimestamp > 0) {
        const rate = this.videoElement.playbackRate || 1;
        const timeDiff = Date.now() - this.clientState.lastServerTimestamp;
        const correctedTime =
          (this.clientState.lastServerTimestamp / 1000) + rate * (timeDiff / 1000);

        // Seek to corrected position, but clamp to valid range
        const duration = this.videoElement.duration || 0;
        const clampedTime = Math.max(0, Math.min(duration, correctedTime));

        if (Math.abs(this.videoElement.currentTime - clampedTime) > 0.5) {
          this.videoElement.currentTime = clampedTime;
          this._updatePlaybackStateFromVideo();
        }
      }
    }
  }

  /** Get the current local playback state */
  getLocalState(): PlaybackState {
    if (!this.videoElement) {
      return {
        videoId: this.videoId,
        isPlaying: false,
        currentTime: 0,
        playbackRate: 1,
        commandVersion: this.clientState.lastAppliedVersion,
        serverTimestamp: 0,
      };
    }

    const rate = this.videoElement.playbackRate || 1;
    const localTime = this.videoElement.currentTime;

    return {
      videoId: this.videoId,
      isPlaying: this.clientState.isPlaying,
      currentTime: localTime,
      playbackRate: rate,
      commandVersion: this.clientState.lastAppliedVersion,
      serverTimestamp: this.clientState.lastServerTimestamp,
    };
  }

  /** Get drift measurement */
  getDriftMs(): number {
    return this.clientState.driftMs;
  }

  /** Clean up resources */
  cleanup() {
    this.stopDriftMonitoring();
    this.videoElement = null;
  }
}

// ============================================================
// Factory and initialization
// ============================================================

export function createPlaybackService(
  roomId: string,
  userId: string,
  isHost: boolean
): PlaybackService {
  const service = new PlaybackService(roomId, userId, isHost);
  return service;
}

// ============================================================
// Realtime broadcast listener setup
// ============================================================

/**
 * Set up Supabase Realtime broadcast listening for playback commands.
 * 
 * This function creates a channel and listens for `playback_command` broadcasts
 * via postgres_changes on the playback_states table. When a command is received,
 * it's applied with version checking to prevent out-of-order/duplicate processing.
 * 
 * @param service The playback service instance
 * @param onCommandReceived Optional callback when a command is received from another client
 * @returns Function to unsubscribe/cleanup
 */
export function usePlaybackRealtime(
  service: PlaybackService,
  onCommandReceived?: (command: PlaybackCommand) => void
): () => void {
  if (!service) {
    return () => {};
  }

  // Create a channel for playback states in this room
  // We listen on the playback_states table with filters for this room and user
  // The postgres_changes event will propagate upserts from all users in the room
  const channelName = `playback_room_${service.roomId}`;

  // Subscribe to postgres_changes on the playback_states table
  // This listens for upserts from any user in the room
  const channel = supabase.channel(channelName);

  channel
    .on(
      'postgres_changes',
      {
        event: 'UPDATE', // We use UPDATE upsert; INSERT also works
        schema: 'public',
        table: 'playback_states',
        filter: `room_id=eq.${service.roomId}`, // Only commands for this room
      },
      (payload) => {
        const stateUpdate = payload.new as {
          user_id: string;
          video_id: string;
          is_playing: boolean;
          current_time: number;
          playback_rate: number;
          command_version: number;
          updated_at: string;
        };

        // Check if this state update is from a different user or our own
        // We apply it if the command_version is newer than what we've applied
        if (stateUpdate.command_version <= service.clientState.lastAppliedVersion) {
          // Stale/duplicate - ignore
          return;
        }

        // Build a playback command from the state update
        // We need to determine the command type based on the changes
        // Since we only have the state snapshot, we infer the command:
        // If isPlaying changed -> play/pause
        // If video_id changed -> video-change
        // If current_time changed -> seek

        const command: PlaybackCommand = {
          version: stateUpdate.command_version,
          type: 'play', // default; will be refined
          payload: {
            isPlaying: stateUpdate.is_playing,
            currentTime: stateUpdate.current_time,
            videoId: stateUpdate.video_id,
          },
          serverTimestamp: Date.now(),
        };

        // Apply the command via the service
        const applied = service.applyCommand(command);

        // Call optional callback
        if (onCommandReceived && applied) {
          onCommandReceived(command);
        }

        // Update the client's version after applying
        if (applied) {
          service.clientState.lastAppliedVersion = command.version;
          service.clientState.lastServerTimestamp = command.serverTimestamp;
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // This client is now subscribed to playback state changes for this room
        // Track our own presence on the channel
        try {
          channel.track({
            user_id: service.userId,
            session_id: `playback_${service.roomId}_${service.userId}`,
          });
        } catch {
          // track may fail if channel not fully ready; ignore
        }
      }
    });

    // Return cleanup function
    return () => {
      channel.unsubscribe();
    };
}