import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isAllowedReaction } from '../lib/reactions';
import type { DbMessage, DbPlayback } from '../services/roomFeaturesService';
import type { Room, User, DbRoom } from '../types';

export type RealtimeStatus = 'idle' | 'live' | 'reconnecting';

export interface RoomRealtimeHandlers {
  /** room_members changed: reload the member list */
  onMembersChanged: () => void;
  /** rooms row changed (host, movie, name) */
  onRoomUpdate: (updatedRoom: Partial<Room>) => void;
  /** Auth user ids currently connected to the room */
  onOnlineUsersChange: (onlineIds: Set<string>) => void;
  onPlaybackRow: (row: DbPlayback) => void;
  onMessageRow: (row: DbMessage) => void;
  onPlaylistChanged: () => void;
  onPollsChanged: () => void;
  onReaction: (reaction: { emoji: string; userId: string }) => void;
  /** (Re)connected or tab became visible again: reload everything */
  onResync: () => void;
}

// supabase.channel(topic) returns the EXISTING channel for a topic until
// that channel has fully closed. Closing is asynchronous, so a quick
// re-subscribe (React StrictMode, leave + rejoin) must wait for it.
const pendingRemovals = new Map<string, Promise<unknown>>();

async function waitForTopicToClose(topic: string) {
  await pendingRemovals.get(topic);
  const leftover = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
  if (leftover) await supabase.removeChannel(leftover).catch(() => {});
}

interface UseRoomRealtimeProps {
  room: Room | null;
  currentUser: User;
  handlers: RoomRealtimeHandlers;
}

/**
 * One private Realtime channel per room ("room:<room id>"). Only room
 * members may join it (Realtime Authorization policies in the Stage 2
 * migration). It carries:
 *  - database change events for the room's tables (filtered by RLS),
 *  - emoji reactions (broadcast, not stored),
 *  - online presence, keyed by the authenticated user id.
 */
export function useRoomRealtime({ room, currentUser, handlers }: UseRoomRealtimeProps) {
  // Handlers change every render; keep the latest in a ref so the
  // channel is only re-created when the room or user changes.
  const handlersRef = useRef(handlers);
  const userNameRef = useRef(currentUser.name);
  useEffect(() => {
    handlersRef.current = handlers;
    userNameRef.current = currentUser.name;
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('idle');

  // Demo rooms are local only; never subscribe to the database for them
  const roomId = room && !room.isMockData && isSupabaseConfigured() ? room.id : null;
  const userId = currentUser.id;

  useEffect(() => {
    if (!roomId) return;
    let disposed = false;

    // Bursts of events (e.g. many votes) trigger a single reload.
    const debounced = (fn: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!disposed) fn();
        }, 150);
      };
    };
    const reloadMembers = debounced(() => handlersRef.current.onMembersChanged());
    const reloadPlaylist = debounced(() => handlersRef.current.onPlaylistChanged());
    const reloadPolls = debounced(() => handlersRef.current.onPollsChanged());
    const resync = () => {
      if (!disposed) handlersRef.current.onResync();
    };
    const filter = `room_id=eq.${roomId}`;
    const topic = `room:${roomId}`;
    let channel: RealtimeChannel | null = null;

    const start = async () => {
      await waitForTopicToClose(topic);
      if (disposed) return;

      const ch = supabase.channel(topic, {
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: userId, enabled: true },
          postgres_changes_options: { wait: true },
        },
      });
      channel = ch;
      channelRef.current = ch;
      subscribe(ch);
    };

    const subscribe = (ch: RealtimeChannel) => ch
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter }, reloadMembers)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
        const updated = payload.new as DbRoom;
        handlersRef.current.onRoomUpdate({
          hostId: updated.host_id,
          currentMovieId: updated.current_movie_id,
          name: updated.name,
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_playback', filter }, (payload) => {
        if (payload.eventType !== 'DELETE') handlersRef.current.onPlaybackRow(payload.new as DbPlayback);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter }, (payload) => {
        handlersRef.current.onMessageRow(payload.new as DbMessage);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_playlist_items', filter }, reloadPlaylist)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_polls', filter }, reloadPolls)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_poll_votes', filter }, reloadPolls)
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        const { emoji, userId: from } = (payload ?? {}) as { emoji?: unknown; userId?: unknown };
        if (isAllowedReaction(emoji) && typeof from === 'string') {
          handlersRef.current.onReaction({ emoji, userId: from });
        }
      })
      .on('presence', { event: 'sync' }, () => {
        handlersRef.current.onOnlineUsersChange(new Set(Object.keys(ch.presenceState())));
      })
      .subscribe(async (state, err) => {
        if (disposed) return;
        if (state === 'SUBSCRIBED') {
          setStatus('live');
          await ch.track({ name: userNameRef.current, online_at: new Date().toISOString() });
          // Catch up on anything missed while (re)connecting
          resync();
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          // supabase-js keeps retrying the join automatically
          setStatus('reconnecting');
          if (err) console.warn('Room realtime channel:', err.message);
        }
      });

    void start();

    // Initial load right away, without waiting for the channel
    resync();

    // Coming back online or to the tab: reload in case events were missed
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    window.addEventListener('online', resync);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      window.removeEventListener('online', resync);
      document.removeEventListener('visibilitychange', onVisible);
      channelRef.current = null;
      if (channel) {
        const removal = supabase.removeChannel(channel).catch(() => {});
        pendingRemovals.set(topic, removal);
        void removal.then(() => {
          if (pendingRemovals.get(topic) === removal) pendingRemovals.delete(topic);
        });
      }
    };
  }, [roomId, userId]);

  /** Broadcast an emoji reaction to everyone else in the room. */
  const sendReaction = useCallback(
    (emoji: string) => {
      const channel = channelRef.current;
      if (!channel || !isAllowedReaction(emoji)) return;
      void channel.send({ type: 'broadcast', event: 'reaction', payload: { emoji, userId } });
    },
    [userId]
  );

  return { status: roomId ? status : ('idle' as RealtimeStatus), sendReaction };
}
