import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ensureSignedIn } from '../lib/auth';
import type { Room, User, DbRoom, DbRoomMember } from '../types';
import { mockRoom, mockMembers } from '../mockData';

// When Supabase is configured, every operation below goes through the
// secure database functions defined in
// supabase/migrations/20261016120000_secure_rooms_and_membership.sql.
// Failures are returned as errors — there is no silent local fallback.
// The local "demo mode" branches only run when Supabase is NOT configured.

const CODE_PREFIXES = ['FILM', 'CAMPUS', 'CINE', 'INDIE', 'NEON', 'VIBE'];
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Format of codes issued by the server, e.g. FILM-7K3QX9 */
export const ROOM_CODE_PATTERN = /^[A-Z]{2,10}-[2-9A-HJKMNP-Z]{6}$/;

/**
 * Generates a demo-mode room code in the same format the server uses.
 * Real rooms get their code from the database.
 */
export function generateRoomCode(): string {
  const random = crypto.getRandomValues(new Uint8Array(7));
  const prefix = CODE_PREFIXES[random[0] % CODE_PREFIXES.length];
  const suffix = Array.from(random.slice(1), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${prefix}-${suffix}`;
}

export interface CreateRoomInput {
  name: string;
  movieId: string;
  isPrivate: boolean;
  hostUser: User;
}

type RoomResult = { room: Room; error?: undefined } | { room: null; error: string };

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return fallback;
}

function mapDbRoomToRoom(data: DbRoom): Room {
  return {
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
}

/**
 * Creates a new room. The signed-in user becomes host on the server.
 */
export async function createRoom(input: CreateRoomInput): Promise<RoomResult> {
  if (!isSupabaseConfigured()) {
    // Demo mode: Supabase keys are not configured.
    return {
      room: {
        id: `local-room-${Date.now()}`,
        code: generateRoomCode(),
        name: input.name,
        description: `Synchronized session created by ${input.hostUser.name}.`,
        hostId: input.hostUser.id,
        currentMovieId: input.movieId,
        membersCount: 1,
        isPrivate: input.isPrivate,
        isMockData: true,
      },
    };
  }

  try {
    await ensureSignedIn();
    const { data, error } = await supabase.rpc('create_room', {
      p_name: input.name,
      p_movie_id: input.movieId,
      p_is_private: input.isPrivate,
      p_display_name: input.hostUser.name,
      p_avatar: input.hostUser.avatar,
      p_color: input.hostUser.color,
    });
    if (error) throw error;
    return { room: mapDbRoomToRoom(data as DbRoom) };
  } catch (err: unknown) {
    console.error('createRoom error:', err);
    return { room: null, error: errorMessage(err, 'Failed to create room.') };
  }
}

/**
 * Joins a room by its code and returns it. Membership and host status
 * are decided by the server.
 */
export async function joinRoom(code: string, user: User): Promise<RoomResult> {
  const cleanCode = code.trim().toUpperCase();

  if (!isSupabaseConfigured()) {
    // Demo mode: any code opens a local mock room.
    if (cleanCode === mockRoom.code) {
      return { room: mockRoom };
    }
    return { room: { ...mockRoom, code: cleanCode, name: `Party Room: ${cleanCode}` } };
  }

  try {
    await ensureSignedIn();
    const { data, error } = await supabase.rpc('join_room', {
      p_code: cleanCode,
      p_display_name: user.name,
      p_avatar: user.avatar,
      p_color: user.color,
    });
    if (error) throw error;
    return { room: mapDbRoomToRoom(data as DbRoom) };
  } catch (err: unknown) {
    console.error('joinRoom error:', err);
    return { room: null, error: errorMessage(err, 'Failed to join room.') };
  }
}

/**
 * Fetches all members in a room and marks `isSelf` based on the current user ID.
 * Row Level Security only returns rows for rooms the user belongs to.
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
 * Removes the current user from a room. If they were host, the server
 * hands host to the longest-present remaining member.
 */
export async function leaveRoom(code: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) return {};

  const { error } = await supabase.rpc('leave_room', { p_code: code });
  if (error) {
    console.error('leaveRoom error:', error);
    return { error: error.message };
  }
  return {};
}

/**
 * Transfers host permissions. The server rejects this unless the caller
 * is the current host and the target is a member.
 */
export async function transferRoomHost(
  code: string,
  newHostUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: true };
  }

  const { error } = await supabase.rpc('transfer_host', {
    p_code: code,
    p_new_host_id: newHostUserId,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Changes the room's current movie. Host only (enforced by the server).
 */
export async function setRoomMovie(code: string, movieId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) return {};

  const { error } = await supabase.rpc('set_room_movie', {
    p_code: code,
    p_movie_id: movieId,
  });
  if (error) {
    return { error: error.message };
  }
  return {};
}
