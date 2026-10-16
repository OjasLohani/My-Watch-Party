// Data Models (Types) for Watch Party
// TypeScript types declare the shape of data across our frontend components and database.

export interface User {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  isSelf: boolean;
  color: string; // Hex color for user avatar/tag
  isOnline?: boolean;
}

export interface Movie {
  id: string;
  title: string;
  description: string;
  backdropUrl: string;
  posterUrl: string;
  videoUrl: string;
  /** Alternative copies of the same video, tried in order if videoUrl fails */
  fallbackVideoUrls?: string[];
  /** Attribution required by the video's licence */
  videoCredit?: string;
  genre: string;
  category: string; // e.g., 'Sci-Fi', 'Animation', 'Documentary', 'Cyberpunk', 'Classics'
  year: number;
  rating: number; // e.g., 8.9
  duration: string; // e.g., "12 min"
  featured?: boolean;
  director?: string;
}

export interface PlaylistItem {
  id: string;
  movieId: string;
  title: string;
  duration: string;
  thumbnailUrl: string;
  videoUrl: string;
  addedBy: string;
  /** User id of who added it, to show their current name */
  addedById?: string;
  year?: string | number;
  genre?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userColor: string;
  text: string;
  timestamp: string;
  isSystem?: boolean;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  x: number; // Percentage 10-90
  createdAt: number;
}

export interface PollOption {
  id: string;
  title: string;
  votes: number;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  userVotedOptionId?: string;
  active: boolean;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number; // in seconds
  duration: number; // in seconds
  playbackRate: number;
  lastUpdated: number; // epoch ms
  syncedDriftMs: number; // estimated drift in milliseconds
}

export interface Room {
  id: string;
  code: string;
  name: string;
  description: string;
  hostId: string;
  currentMovieId: string;
  membersCount: number;
  isPrivate: boolean;
  isMockData: boolean;
}

// Supabase Database Row Types
export interface DbRoom {
  id: string;
  code: string;
  name: string;
  description: string;
  host_id: string;
  current_movie_id: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbRoomMember {
  id: string;
  room_id: string;
  user_id: string;
  name: string;
  avatar: string;
  color: string;
  is_host: boolean;
  last_seen_at: string;
  created_at: string;
}

export interface Toast {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
}

export type ViewMode = 'discover' | 'room';
export type SortOption = 'rating-desc' | 'year-desc' | 'title-asc' | 'duration-asc';
