import { supabase } from '../lib/supabase';
import { pickClockOffset } from '../lib/playbackService';
import type { ClockSample, PlaybackSnapshot } from '../lib/playbackState';
import type { ChatMessage, Movie, PlaylistItem, Poll } from '../types';

// Shared room features (Stage 2). Reads use normal table queries, which
// Row Level Security limits to rooms the user belongs to. Every write
// goes through a database function that checks membership / host rights
// (see supabase/migrations/20261017120000_stage2_shared_room_features.sql).

type Result<T = undefined> = { data?: T; error?: string };

// ---------------------------------------------------------------- playback

export interface DbPlayback {
  room_id: string;
  movie_id: string;
  is_playing: boolean;
  position_sec: number;
  playback_rate: number;
  version: number | string;
  updated_at_ms: number;
  updated_by: string;
}

export function mapPlayback(row: DbPlayback): PlaybackSnapshot {
  return {
    movieId: row.movie_id,
    isPlaying: row.is_playing,
    position: Number(row.position_sec),
    rate: Number(row.playback_rate) || 1,
    updatedAtMs: Number(row.updated_at_ms),
    version: Number(row.version),
    updatedBy: row.updated_by,
  };
}

export async function fetchPlayback(roomId: string): Promise<PlaybackSnapshot | null> {
  const { data, error } = await supabase.from('room_playback').select('*').eq('room_id', roomId).maybeSingle();
  if (error) {
    console.error('fetchPlayback error:', error);
    return null;
  }
  return data ? mapPlayback(data as DbPlayback) : null;
}

/** Host only: publish the shared playback state. */
export async function setPlayback(
  code: string,
  state: { movieId: string; isPlaying: boolean; position: number }
): Promise<Result<PlaybackSnapshot>> {
  const { data, error } = await supabase.rpc('set_playback', {
    p_code: code,
    p_movie_id: state.movieId,
    p_is_playing: state.isPlaying,
    p_position: Math.max(0, Number.isFinite(state.position) ? state.position : 0),
  });
  if (error) return { error: error.message };
  return { data: mapPlayback(data as DbPlayback) };
}

/** Estimates server clock − local clock in ms (null if unreachable). */
export async function measureClockOffset(samples = 5): Promise<number | null> {
  const results: ClockSample[] = [];
  for (let i = 0; i < samples; i++) {
    const sentAt = Date.now();
    const { data, error } = await supabase.rpc('server_time');
    const receivedAt = Date.now();
    if (!error) results.push({ sentAt, serverMs: Number(data), receivedAt });
  }
  return pickClockOffset(results)?.offsetMs ?? null;
}

// -------------------------------------------------------------------- chat

export interface DbMessage {
  id: number;
  room_id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  user_color: string;
  body: string;
  created_at: string;
}

export function mapMessage(row: DbMessage): ChatMessage {
  const created = new Date(row.created_at);
  return {
    id: `db-${row.id}`,
    userId: row.user_id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
    userColor: row.user_color,
    text: row.body,
    timestamp: Number.isNaN(created.getTime())
      ? ''
      : created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

/** The latest messages, oldest first. */
export async function fetchMessages(roomId: string, limit = 100): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('room_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('id', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('fetchMessages error:', error);
    return [];
  }
  return (data as DbMessage[]).reverse().map(mapMessage);
}

export async function sendMessage(code: string, body: string): Promise<Result<ChatMessage>> {
  const { data, error } = await supabase.rpc('send_message', { p_code: code, p_body: body });
  if (error) return { error: error.message };
  return { data: mapMessage(data as DbMessage) };
}

// ---------------------------------------------------------------- playlist

interface DbPlaylistItem {
  id: number;
  movie_id: string;
  position: number;
  added_by_name: string;
}

export async function fetchPlaylist(roomId: string, catalog: Movie[]): Promise<PlaylistItem[]> {
  const { data, error } = await supabase
    .from('room_playlist_items')
    .select('id, movie_id, position, added_by_name')
    .eq('room_id', roomId)
    .order('position', { ascending: true });
  if (error) {
    console.error('fetchPlaylist error:', error);
    return [];
  }
  return (data as DbPlaylistItem[]).flatMap((row) => {
    const movie = catalog.find((m) => m.id === row.movie_id);
    if (!movie) return [];
    return [{
      id: String(row.id),
      movieId: movie.id,
      title: movie.title,
      duration: movie.duration,
      thumbnailUrl: movie.posterUrl,
      videoUrl: movie.videoUrl,
      addedBy: row.added_by_name,
      year: movie.year,
      genre: movie.category,
    }];
  });
}

async function simpleRpc(fn: string, args: Record<string, unknown>): Promise<Result> {
  const { error } = await supabase.rpc(fn, args);
  return error ? { error: error.message } : {};
}

export const playlistAdd = (code: string, movieId: string) =>
  simpleRpc('playlist_add', { p_code: code, p_movie_id: movieId });

export const playlistRemove = (code: string, itemId: string) =>
  simpleRpc('playlist_remove', { p_code: code, p_item_id: Number(itemId) });

export const playlistMove = (code: string, itemId: string, direction: -1 | 1) =>
  simpleRpc('playlist_move', { p_code: code, p_item_id: Number(itemId), p_direction: direction });

// ------------------------------------------------------------------- polls

interface DbPoll {
  id: number;
  question: string;
  options: string[];
}

/** The room's active poll with live counts, or null if there is none. */
export async function fetchActivePoll(roomId: string, userId: string): Promise<Poll | null> {
  const { data: poll, error } = await supabase
    .from('room_polls')
    .select('id, question, options')
    .eq('room_id', roomId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    console.error('fetchActivePoll error:', error);
    return null;
  }
  if (!poll) return null;

  const { data: votes, error: votesError } = await supabase
    .from('room_poll_votes')
    .select('user_id, option_index')
    .eq('poll_id', (poll as DbPoll).id);
  if (votesError) console.error('fetchActivePoll votes error:', votesError);

  const rows = (votes ?? []) as { user_id: string; option_index: number }[];
  const counts = (poll as DbPoll).options.map((_, i) => rows.filter((v) => v.option_index === i).length);
  const mine = rows.find((v) => v.user_id === userId);

  return {
    id: String((poll as DbPoll).id),
    question: (poll as DbPoll).question,
    options: (poll as DbPoll).options.map((title, i) => ({ id: String(i), title, votes: counts[i] })),
    totalVotes: rows.length,
    userVotedOptionId: mine ? String(mine.option_index) : undefined,
    active: true,
  };
}

export const createPoll = (code: string, question: string, options: string[]) =>
  simpleRpc('create_poll', { p_code: code, p_question: question, p_options: options });

export const closePoll = (code: string, pollId: string) =>
  simpleRpc('close_poll', { p_code: code, p_poll_id: Number(pollId) });

export const votePoll = (code: string, pollId: string, optionId: string) =>
  simpleRpc('vote_poll', { p_code: code, p_poll_id: Number(pollId), p_option: Number(optionId) });
