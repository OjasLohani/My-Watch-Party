import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Room, User, DbRoom, DbRoomMember } from '../types';
import { mockRoom, mockMembers } from '../mockData';

const CODE_PREFIXES = ['FILM', 'CAMPUS', 'CINE', 'INDIE', 'NEON', 'VIBE'];

/**
 * Generates a memorable, human-friendly uppercase room code (e.g. FILM-404, CAMPUS-819)
 */
export function generateRoomCode(): string {
  const prefix = CODE_PREFIXES[Math.floor(Math.random() * CODE_PREFIXES.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${num}`;
}

export interface CreateRoomInput {
  name: string;
  movieId: string;
  isPrivate: boolean;
  hostUser: User;
}

/**
 * Creates a new room in Supabase (or local fallback if Supabase keys are pending)
 */
export async function createRoom(input: CreateRoomInput): Promise<{ room: Room; error?: string }> {
  const code = generateRoomCode();

  if (!isSupabaseConfigured()) {
    // Graceful fallback to interactive local room if user has not entered Supabase keys yet
    const localRoom: Room = {
      id: `local-room-${Date.now()}`,
      code,
      name: input.name,
      description: `Synchronized session created by ${input.hostUser.name}.`,
      hostId: input.hostUser.id,
      currentMovieId: input.movieId,
      membersCount: 1,
      isPrivate: input.isPrivate,
      isMockData: true,
    };
    return { room: localRoom };
  }

  try {
    // 1. Insert room record
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .insert({
        code,
        name: input.name,
        description: `Synchronized screening hosted by ${input.hostUser.name}.`,
        host_id: input.hostUser.id,
        current_movie_id: input.movieId,
        is_private: input.isPrivate,
      })
      .select()
      .single();

    if (roomError) {
      // If code collided (rare), retry once with fresh code
      if (roomError.code === '23505') {
        const altCode = generateRoomCode();
        const { data: retryData, error: retryError } = await supabase
          .from('rooms')
          .insert({
            code: altCode,
            name: input.name,
            description: `Synchronized screening hosted by ${input.hostUser.name}.`,
            host_id: input.hostUser.id,
            current_movie_id: input.movieId,
            is_private: input.isPrivate,
          })
          .select()
          .single();

        if (retryError) throw retryError;
        return mapDbRoomToRoom(retryData);
      }
      throw roomError;
    }

    // 2. Insert host member record
    const { error: memberError } = await supabase
      .from('room_members')
      .insert({
        room_id: roomData.id,
        user_id: input.hostUser.id,
        name: input.hostUser.name,
        avatar: input.hostUser.avatar,
        color: input.hostUser.color,
        is_host: true,
      });

    if (memberError) {
      console.warn('Host membership insert notice:', memberError);
    }

    return mapDbRoomToRoom(roomData);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to create room in database.';
    console.error('createRoom error:', err);
    return {
      room: {
        id: `room-${Date.now()}`,
        code,
        name: input.name,
        description: '',
        hostId: input.hostUser.id,
        currentMovieId: input.movieId,
        membersCount: 1,
        isPrivate: input.isPrivate,
        isMockData: true,
      },
      error: errorMsg,
    };
  }
}

/**
 * Finds an existing room by its human-friendly code
 */
export async function getRoomByCode(code: string): Promise<{ room: Room | null; error?: string }> {
  const cleanCode = code.trim().toUpperCase();

  if (!isSupabaseConfigured()) {
    if (cleanCode === mockRoom.code) {
      return { room: mockRoom };
    }
    // Create an ad-hoc local mock room for testing
    return {
      room: {
        ...mockRoom,
        code: cleanCode,
        name: `Party Room: ${cleanCode}`,
      },
    };
  }

  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', cleanCode)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { room: null, error: `No active room found with code "${cleanCode}".` };

    const mappedRoom: Room = {
      id: data.id,
      code: data.code,
      name: data.name,
      description: data.description || '',
      hostId: data.host_id,
      currentMovieId: data.current_movie_id,
      membersCount: 1,
      isPrivate: data.is_private,
      isMockData: false,
    };

    return { room: mappedRoom };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Database error while querying room.';
    return { room: null, error: msg };
  }
}

/**
 * Fetches all members in a room and marks `isSelf` based on the current user ID
 */
export async function getRoomMembers(roomId: string, currentUserId: string): Promise<User[]> {
  if (!isSupabaseConfigured()) {
    return mockMembers.map((m) => ({
      ...m,
      isSelf: m.id === currentUserId,
      isOnline: true,
    }));
  }

  try {
    const { data, error } = await supabase
      .from('room_members')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((m: DbRoomMember) => ({
      id: m.user_id,
      name: m.name,
      avatar: m.avatar,
      color: m.color,
      isHost: m.is_host,
      isSelf: m.user_id === currentUserId,
      isOnline: true,
    }));
  } catch (err) {
    console.error('getRoomMembers error:', err);
    return [];
  }
}

/**
 * Adds or updates a user in the room_members table
 */
export async function joinRoomMember(roomId: string, user: User): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    await supabase.from('room_members').upsert(
      {
        room_id: roomId,
        user_id: user.id,
        name: user.name,
        avatar: user.avatar,
        color: user.color,
        is_host: user.isHost,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'room_id,user_id' }
    );
  } catch (err) {
    console.error('joinRoomMember error:', err);
  }
}

/**
 * Removes a user from room_members when leaving
 */
export async function leaveRoomMember(roomId: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);
  } catch (err) {
    console.error('leaveRoomMember error:', err);
  }
}

/**
 * Transfers host permissions in database
 */
export async function transferRoomHost(
  roomId: string,
  newHostUserId: string,
  prevHostUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: true };
  }

  try {
    // 1. Update rooms table
    const { error: roomErr } = await supabase
      .from('rooms')
      .update({ host_id: newHostUserId, updated_at: new Date().toISOString() })
      .eq('id', roomId);

    if (roomErr) throw roomErr;

    // 2. Demote previous host
    await supabase
      .from('room_members')
      .update({ is_host: false })
      .eq('room_id', roomId)
      .eq('user_id', prevHostUserId);

    // 3. Promote new host
    await supabase
      .from('room_members')
      .update({ is_host: true })
      .eq('room_id', roomId)
      .eq('user_id', newHostUserId);

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to transfer host.';
    return { success: false, error: msg };
  }
}

function mapDbRoomToRoom(data: DbRoom): { room: Room } {
  return {
    room: {
      id: data.id,
      code: data.code,
      name: data.name,
      description: data.description || '',
      hostId: data.host_id,
      currentMovieId: data.current_movie_id,
      membersCount: 1,
      isPrivate: data.is_private,
      isMockData: false,
    },
  };
}
