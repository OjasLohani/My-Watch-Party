import { useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getRoomMembers } from '../services/roomService';
import type { Room, User, DbRoom } from '../types';

interface UseRoomRealtimeProps {
  room: Room | null;
  currentUser: User;
  onMembersUpdate: (members: User[]) => void;
  onRoomUpdate: (updatedRoom: Partial<Room>) => void;
}

export function useRoomRealtime({
  room,
  currentUser,
  onMembersUpdate,
  onRoomUpdate,
}: UseRoomRealtimeProps) {
  useEffect(() => {
    if (!room || !isSupabaseConfigured()) return;

    const roomId = room.id;
    const channelName = `room_realtime_${room.code}`;
    const channel = supabase.channel(channelName);

    // 1. Listen for member changes in database
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${roomId}`,
        },
        async () => {
          const freshMembers = await getRoomMembers(roomId, currentUser.id);
          onMembersUpdate(freshMembers);
        }
      )
      // 2. Listen for room updates (e.g. host change or movie change)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const newRoomData = payload.new as DbRoom;
          onRoomUpdate({
            hostId: newRoomData.host_id,
            currentMovieId: newRoomData.current_movie_id,
            name: newRoomData.name,
          });
        }
      )
      // 3. Realtime Presence for sub-second online tracking
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const onlineIds = new Set<string>();

        Object.values(presenceState).forEach((presences) => {
          (presences as Array<{ user_id?: string }>).forEach((p) => {
            if (p.user_id) onlineIds.add(p.user_id);
          });
        });

        // Mark members as online if their presence is active
        getRoomMembers(roomId, currentUser.id).then((members) => {
          const updated = members.map((m) => ({
            ...m,
            isOnline: onlineIds.has(m.id) || m.id === currentUser.id,
          }));
          onMembersUpdate(updated);
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track this user's online presence
          await channel.track({
            user_id: currentUser.id,
            name: currentUser.name,
            online_at: new Date().toISOString(),
          });
        }
      });

    // Cleanup when leaving room or unmounting
    return () => {
      channel.unsubscribe();
    };
  }, [room?.id, room?.code, currentUser.id]);
}

