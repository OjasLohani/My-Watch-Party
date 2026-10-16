import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { DiscoverHero } from './components/DiscoverHero';
import { MovieGrid } from './components/MovieGrid';
import { ToastContainer } from './components/ToastContainer';

// Loaded on demand: not needed for the first view of the homepage
const WatchRoomScreen = lazy(() =>
  import('./components/WatchRoom/WatchRoomScreen').then((m) => ({ default: m.WatchRoomScreen })));
const CreateRoomModal = lazy(() =>
  import('./components/CreateRoomModal').then((m) => ({ default: m.CreateRoomModal })));
const NameModal = lazy(() =>
  import('./components/NameModal').then((m) => ({ default: m.NameModal })));
const JoinRoomModal = lazy(() =>
  import('./components/JoinRoomModal').then((m) => ({ default: m.JoinRoomModal })));
const StageOverview = lazy(() =>
  import('./components/StageOverview').then((m) => ({ default: m.StageOverview })));

/** Shown while a lazily loaded part of the app downloads */
function SectionLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center gap-2 text-xs text-slate-400" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
      <span>{label}</span>
    </div>
  );
}
import { isSupabaseConfigured } from './lib/supabase';
import { getOrCreateSessionUser, getChosenName, hasChosenName, saveChosenName } from './lib/session';
import { ensureSignedIn } from './lib/auth';
import { isNewerSnapshot } from './lib/playbackService';
import type { PlaybackSnapshot } from './lib/playbackState';
import {
  createRoom as apiCreateRoom,
  joinRoom as apiJoinRoom,
  getRoomMembers as apiGetRoomMembers,
  leaveRoom as apiLeaveRoom,
  transferRoomHost as apiTransferRoomHost,
  claimHost as apiClaimHost,
  renewConnectionLease as apiRenewConnectionLease,
  renewConnectionLeaseOnExit as apiRenewConnectionLeaseOnExit,
  autoTransferHost as apiAutoTransferHost,
  fetchRoom as apiFetchRoom,
  updateMyDisplayName as apiUpdateMyDisplayName
} from './services/roomService';
import {
  closePoll as apiClosePoll,
  createPoll as apiCreatePoll,
  fetchActivePoll,
  fetchMessages,
  fetchPlayback,
  fetchPlaylist,
  mapMessage,
  mapPlayback,
  measureClockOffset,
  playlistAdd as apiPlaylistAdd,
  playlistMove as apiPlaylistMove,
  playlistRemove as apiPlaylistRemove,
  sendMessage as apiSendMessage,
  setPlayback as apiSetPlayback,
  votePoll as apiVotePoll,
} from './services/roomFeaturesService';
import { useRoomRealtime } from './hooks/useRoomRealtime';
import { useConnectionLease } from './hooks/useConnectionLease';
import { useAutoHostTransfer } from './hooks/useAutoHostTransfer';
import {
  mockRoom,
  mockMovies,
  mockPlaylist,
  mockChatMessages,
  mockPoll
} from './mockData';
import type {
  User,
  Room,
  Movie,
  PlaylistItem,
  ChatMessage,
  Poll,
  ViewMode,
  Toast,
  FloatingReaction
} from './types';

/** Minimum gap between two reactions from this browser */
const REACTION_COOLDOWN_MS = 250;
/** How long a server clock offset measurement is reused */
const CLOCK_REMEASURE_MS = 120_000;
/** Host missing from Presence this long: show the "disconnected" notice */
const HOST_NOTICE_MS = 5_000;
/** Fallback: offer the manual takeover (Stage 3 rule) after this long */
const HOST_MANUAL_TAKEOVER_MS = 60_000;

export default function App() {
  // Navigation View State
  const [currentView, setCurrentView] = useState<ViewMode>('discover');

  // Persistent browser user session
  const [currentUser, setCurrentUser] = useState<User>(getOrCreateSessionUser);

  // Active Room & Member State
  const [activeRoom, setActiveRoom] = useState<Room>(mockRoom);
  const [currentMovie, setCurrentMovie] = useState<Movie>(mockMovies[0]);
  const [members, setMembers] = useState<User[]>([currentUser]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(mockPlaylist);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(mockChatMessages);
  const [poll, setPoll] = useState<Poll | null>(mockPoll);
  const [driftMs, setDriftMs] = useState<number>(24);

  // Shared state for real (Supabase) rooms
  const [playback, setPlayback] = useState<PlaybackSnapshot | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  // Estimated one-way delay to the server (half the measured round trip)
  const [serverDelayMs, setServerDelayMs] = useState(0);
  const [onlineIds, setOnlineIds] = useState<Set<string> | null>(null);
  // When the host was last seen online, and a clock that ticks every 15 s
  const [hostSeenAt, setHostSeenAt] = useState(() => Date.now());
  const [presenceTick, setPresenceTick] = useState(() => Date.now());
  const isRealRoom = !activeRoom.isMockData;
  const activeRoomIdRef = useRef(activeRoom.id);
  const lastReactionAtRef = useRef(0);
  const clockMeasuredRef = useRef<{ roomId: string | null; at: number }>({ roomId: null, at: 0 });
  useEffect(() => {
    activeRoomIdRef.current = activeRoom.id;
  }, [activeRoom.id]);

  // Modals & Floating Overlays
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  // Name dialog: before joining (remembers which room to join next) or to edit
  const [namePrompt, setNamePrompt] = useState<{ mode: 'join'; roomCode: string } | { mode: 'edit' } | null>(null);
  const [selectedMovieForCreate, setSelectedMovieForCreate] = useState<string | undefined>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [showArchBenchmark, setShowArchBenchmark] = useState(false);

  // Helper for Toasts
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Sign in as a guest (Supabase anonymous auth) so this browser has a
  // real, server-verified identity before creating or joining rooms.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    ensureSignedIn()
      .then((authUserId) => {
        setCurrentUser((prev) => (prev.id === authUserId ? prev : { ...prev, id: authUserId }));
      })
      .catch((err: unknown) => {
        addToast(err instanceof Error ? err.message : 'Guest sign-in failed.', 'error');
      });
  }, [addToast]);

  // --- Shared room state helpers ---

  /** Keeps only the newest playback state (ignores duplicates / stale echoes) */
  const applyPlayback = useCallback((snapshot: PlaybackSnapshot | null | undefined) => {
    if (!snapshot) return;
    setPlayback((prev) => (isNewerSnapshot(prev, snapshot) ? snapshot : prev));
  }, []);

  const appendMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
  }, []);

  /** Shows a floating emoji over the player for a couple of seconds */
  const showReaction = useCallback((emoji: string) => {
    const newReaction: FloatingReaction = {
      id: `rx-${Date.now()}-${Math.random()}`,
      emoji,
      x: Math.floor(Math.random() * 70) + 15,
      createdAt: Date.now(),
    };

    setFloatingReactions((prev) => [...prev, newReaction].slice(-30));

    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== newReaction.id));
    }, 1800);
  }, []);

  /** Clears room data before entering a real room (it is loaded from the server) */
  const resetRoomData = (mode: 'real' | 'demo') => {
    setPlayback(null);
    setHostSeenAt(Date.now());
    setOnlineIds(null);
    if (mode === 'real') {
      setChatMessages([]);
      setPlaylist([]);
      setPoll(null);
    } else {
      setChatMessages(mockChatMessages);
      setPlaylist(mockPlaylist);
      setPoll(mockPoll);
    }
  };

  /** Applies a host change confirmed by the server (realtime, RPC result or resync) */
  const applyHostChange = useCallback((hostId: string) => {
    setActiveRoom((prev) => (prev.hostId === hostId ? prev : { ...prev, hostId }));
    setCurrentUser((prev) => (prev.isHost === (prev.id === hostId) ? prev : { ...prev, isHost: prev.id === hostId }));
    setMembers((prev) => prev.map((m) => ({ ...m, isHost: m.id === hostId })));
    setHostSeenAt(Date.now());
  }, []);

  /** Loads everything for the current real room (join, reconnect, tab refocus) */
  const resyncRoom = useCallback(async () => {
    if (activeRoom.isMockData) return;
    const roomId = activeRoom.id;
    const userId = currentUser.id;

    const [roomRow, roomMembers, snapshot, messages, items, activePoll] = await Promise.all([
      apiFetchRoom(roomId),
      apiGetRoomMembers(roomId, userId),
      fetchPlayback(roomId),
      fetchMessages(roomId),
      fetchPlaylist(roomId, mockMovies),
      fetchActivePoll(roomId, userId),
    ]);
    if (activeRoomIdRef.current !== roomId) return; // left the room meanwhile

    if (roomMembers.length > 0) setMembers(roomMembers);
    // Host may have changed while we were away (e.g. we were the host and
    // hosting passed to someone else while disconnected)
    if (roomRow) applyHostChange(roomRow.hostId);
    applyPlayback(snapshot);
    setChatMessages(messages);
    setPlaylist(items);
    setPoll(activePoll);

    // Clocks drift slowly: re-measure the server clock offset (5 round
    // trips) only for a new room or every couple of minutes.
    const lastMeasure = clockMeasuredRef.current;
    if (lastMeasure.roomId === roomId && Date.now() - lastMeasure.at < CLOCK_REMEASURE_MS) return;
    const clock = await measureClockOffset();
    if (clock !== null && activeRoomIdRef.current === roomId) {
      clockMeasuredRef.current = { roomId, at: Date.now() };
      setClockOffsetMs(clock.offsetMs);
      setServerDelayMs(clock.rttMs / 2);
    }
  }, [activeRoom.id, activeRoom.isMockData, currentUser.id, applyPlayback, applyHostChange]);

  // Join Room by Code (Used by modal and invite URLs).
  // Returns an error message, or null on success.
  // `chosenName` is passed right after the name dialog (state not updated yet)
  const handleJoinRoom = useCallback(async (code: string, chosenName?: string): Promise<string | null> => {
    const cleanCode = code.trim().toUpperCase();

    // First visit: ask for a display name, then join (see handleSaveName)
    if (!chosenName && !hasChosenName()) {
      setNamePrompt({ mode: 'join', roomCode: cleanCode });
      return null;
    }

    try {
      const userId = isSupabaseConfigured() ? await ensureSignedIn() : currentUser.id;
      const joiningUser: User = { ...currentUser, id: userId, name: chosenName ?? currentUser.name };

      // The server records membership and decides host status
      const { room, error } = await apiJoinRoom(cleanCode, joiningUser);

      if (error || !room) {
        const message = error || `No room found with code "${cleanCode}".`;
        addToast(message, 'error');
        return message;
      }

      const updatedUser: User = { ...joiningUser, isHost: room.hostId === userId };
      setCurrentUser(updatedUser);

      // Fetch active room members
      const roomMembers = await apiGetRoomMembers(room.id, updatedUser.id);
      // Demo rooms use sample members: add yourself so your name shows too
      setMembers(
        room.isMockData
          ? [updatedUser, ...roomMembers.filter((m) => m.id !== updatedUser.id)]
          : roomMembers.length > 0 ? roomMembers : [updatedUser]
      );

      // Set active movie
      const matchedMovie = mockMovies.find((m) => m.id === room.currentMovieId) || mockMovies[0];
      setCurrentMovie(matchedMovie);
      resetRoomData(room.isMockData ? 'demo' : 'real');
      setActiveRoom(room);
      setCurrentView('room');

      // Update URL query parameter for shareable invite link
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('room', room.code);
      window.history.replaceState({}, '', newUrl.toString());

      // Demo rooms get a local announcement; real rooms load shared chat
      if (room.isMockData) {
        const joinMsg: ChatMessage = {
          id: `sys-${Date.now()}`,
          userId: 'system',
          userName: 'Watch Party Bot',
          userAvatar: '',
          userColor: '#94A3B8',
          text: `👋 ${updatedUser.name} connected to room (${room.code}). Synced with theater.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isSystem: true,
        };
        setChatMessages((prev) => [...prev, joinMsg]);
      }
      addToast(`Connected to room ${room.code}!`, 'success');
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to join room.';
      addToast(msg, 'error');
      return msg;
    }
  }, [currentUser, addToast]);

  // Check URL query parameters on initial page load for invite link (?room=CODE).
  // The ref makes sure the invite is joined only once, even though
  // handleJoinRoom changes whenever the current user changes.
  const inviteHandledRef = useRef(false);
  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get('room');
    if (!inviteCode) return;
    const timer = setTimeout(() => {
      if (inviteHandledRef.current) return;
      inviteHandledRef.current = true;
      void handleJoinRoom(inviteCode);
    }, 0);
    return () => clearTimeout(timer);
  }, [handleJoinRoom]);

  // Real-time synchronization for everything shared in the room.
  // Stays connected while in a real room, even on the discover page.
  const { status: realtimeStatus, sendReaction } = useRoomRealtime({
    room: isRealRoom ? activeRoom : null,
    currentUser,
    handlers: {
      onMembersChanged: () => {
        const roomId = activeRoom.id;
        void apiGetRoomMembers(roomId, currentUser.id).then((list) => {
          if (activeRoomIdRef.current === roomId && list.length > 0) setMembers(list);
        });
      },
      onRoomUpdate: (updatedRoom) => {
        setActiveRoom((prev) => ({ ...prev, ...updatedRoom }));
        if (updatedRoom.currentMovieId) {
          const movie = mockMovies.find((m) => m.id === updatedRoom.currentMovieId);
          if (movie) setCurrentMovie(movie);
        }
        if (updatedRoom.hostId) {
          setHostSeenAt(Date.now());
          setCurrentUser((prev) => ({ ...prev, isHost: prev.id === updatedRoom.hostId }));
        }
      },
      onOnlineUsersChange: (ids) => {
        setOnlineIds(ids);
        if (ids.has(activeRoom.hostId)) setHostSeenAt(Date.now());
      },
      onPlaybackRow: (row) => applyPlayback(mapPlayback(row)),
      onMessageRow: (row) => appendMessage(mapMessage(row)),
      onPlaylistChanged: () => {
        const roomId = activeRoom.id;
        void fetchPlaylist(roomId, mockMovies).then((items) => {
          if (activeRoomIdRef.current === roomId) setPlaylist(items);
        });
      },
      onPollsChanged: () => {
        const roomId = activeRoom.id;
        void fetchActivePoll(roomId, currentUser.id).then((activePoll) => {
          if (activeRoomIdRef.current === roomId) setPoll(activePoll);
        });
      },
      onReaction: ({ emoji }) => showReaction(emoji),
      onResync: () => {
        void resyncRoom();
      },
    },
  });

  // In real rooms the shared playback state decides which movie is on screen
  const playbackMovie = isRealRoom && playback ? mockMovies.find((m) => m.id === playback.movieId) : undefined;
  const displayedMovie = playbackMovie ?? currentMovie;

  // Online status comes from Realtime presence in real rooms
  const displayedMembers = isRealRoom && onlineIds
    ? members.map((m) => ({ ...m, isOnline: m.id === currentUser.id || onlineIds.has(m.id) }))
    : members;

  // Host published a play / pause / seek
  const handleHostPlaybackChange = useCallback(async (state: { isPlaying: boolean; position: number }) => {
    if (activeRoom.isMockData) return;
    const { data, error } = await apiSetPlayback(activeRoom.code, { movieId: displayedMovie.id, ...state });
    if (error) {
      addToast(error, 'error');
      return;
    }
    applyPlayback(data);
  }, [activeRoom.isMockData, activeRoom.code, displayedMovie.id, addToast, applyPlayback]);

  // Switch movie to play in room
  const handlePlayMovie = async (movie: Movie) => {
    if (isSupabaseConfigured()) {
      if (activeRoom.isMockData) {
        // Not in a real room yet: start one with this movie preselected.
        setSelectedMovieForCreate(movie.id);
        setIsCreateModalOpen(true);
        return;
      }
      if (!currentUser.isHost) {
        addToast('Only the host can change the movie.', 'warning');
        return;
      }
      // Everyone switches together: the movie is part of the shared playback state
      const { data, error } = await apiSetPlayback(activeRoom.code, { movieId: movie.id, isPlaying: true, position: 0 });
      if (error) {
        addToast(error, 'error');
        return;
      }
      applyPlayback(data);
      setCurrentMovie(movie);
      setActiveRoom((prev) => ({ ...prev, currentMovieId: movie.id }));
      setCurrentView('room');
      addToast(`Switched playback to ${movie.title}`, 'success');
      return;
    }

    setCurrentMovie(movie);
    setActiveRoom((prev) => ({ ...prev, currentMovieId: movie.id }));
    setCurrentView('room');

    const sysMsg: ChatMessage = {
      id: `sys-${Date.now()}`,
      userId: 'system',
      userName: 'Watch Party Bot',
      userAvatar: '',
      userColor: '#94A3B8',
      text: `🎬 Feature film switched to "${movie.title}". Stream synchronized.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSystem: true,
    };
    setChatMessages((prev) => [...prev, sysMsg]);
    addToast(`Switched playback to ${movie.title}`, 'success');
  };

  // --- Shared queue ---

  const reloadPlaylist = async () => {
    const roomId = activeRoom.id;
    const items = await fetchPlaylist(roomId, mockMovies);
    if (activeRoomIdRef.current === roomId) setPlaylist(items);
  };

  // Add to queue
  const handleAddToPlaylist = async (movie: Movie) => {
    if (isRealRoom) {
      if (!currentUser.isHost) {
        addToast('Only the host can add films to the queue.', 'warning');
        return;
      }
      const { error } = await apiPlaylistAdd(activeRoom.code, movie.id);
      if (error) {
        addToast(error, 'warning');
        return;
      }
      await reloadPlaylist();
      addToast(`Added "${movie.title}" to room playlist!`, 'success');
      return;
    }

    const exists = playlist.some((item) => item.movieId === movie.id);
    if (exists) {
      addToast(`"${movie.title}" is already queued in this room.`, 'warning');
      return;
    }

    const newItem: PlaylistItem = {
      id: `pl-${Date.now()}`,
      movieId: movie.id,
      title: movie.title,
      duration: movie.duration,
      thumbnailUrl: movie.posterUrl,
      videoUrl: movie.videoUrl,
      addedBy: currentUser.name,
      year: movie.year,
      genre: movie.category,
    };

    setPlaylist((prev) => [...prev, newItem]);
    addToast(`Added "${movie.title}" to room playlist!`, 'success');
  };

  const handleRemoveFromPlaylist = async (item: PlaylistItem) => {
    if (isRealRoom) {
      const { error } = await apiPlaylistRemove(activeRoom.code, item.id);
      if (error) addToast(error, 'error');
      else await reloadPlaylist();
      return;
    }
    setPlaylist((prev) => prev.filter((p) => p.id !== item.id));
  };

  const handleMovePlaylistItem = async (item: PlaylistItem, direction: -1 | 1) => {
    if (isRealRoom) {
      const { error } = await apiPlaylistMove(activeRoom.code, item.id, direction);
      if (error) addToast(error, 'error');
      else await reloadPlaylist();
      return;
    }
    setPlaylist((prev) => {
      const from = prev.findIndex((p) => p.id === item.id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  // Create Room Handler. Returns an error message, or null on success.
  const handleCreateRoom = async (data: {
    roomName: string;
    movieId: string;
    isPrivate: boolean;
    hostName: string;
  }): Promise<string | null> => {
    const hostName = saveChosenName(data.hostName);
    if (!hostName) return 'Please enter a valid display name.';
    let updatedUser: User = {
      ...currentUser,
      name: hostName,
      isHost: true,
    };

    if (isSupabaseConfigured()) {
      try {
        updatedUser = { ...updatedUser, id: await ensureSignedIn() };
      } catch (err: unknown) {
        return err instanceof Error ? err.message : 'Guest sign-in failed.';
      }
    }

    const chosenMovie = mockMovies.find((m) => m.id === data.movieId) || mockMovies[0];

    const { room, error } = await apiCreateRoom({
      name: data.roomName,
      movieId: chosenMovie.id,
      isPrivate: data.isPrivate,
      hostUser: updatedUser,
    });

    if (!room) {
      addToast(error, 'error');
      return error;
    }

    setCurrentUser(updatedUser);
    resetRoomData(room.isMockData ? 'demo' : 'real');
    setActiveRoom(room);
    setCurrentMovie(chosenMovie);
    setMembers([updatedUser]);
    setCurrentView('room');

    // Update URL query parameter for shareable invite link
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('room', room.code);
    window.history.replaceState({}, '', newUrl.toString());

    addToast(`Room "${room.name}" created with code ${room.code}!`, 'success');
    return null;
  };

  // Send Chat Message
  const handleSendMessage = async (text: string) => {
    if (isRealRoom) {
      const { data, error } = await apiSendMessage(activeRoom.code, text);
      if (error) addToast(error, 'error');
      else if (data) appendMessage(data);
      return;
    }

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      userColor: currentUser.color,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, newMsg]);
  };

  // Trigger floating reaction animation (and send it to the room)
  const handleTriggerReaction = (emoji: string) => {
    const now = Date.now();
    if (now - lastReactionAtRef.current < REACTION_COOLDOWN_MS) return;
    lastReactionAtRef.current = now;
    showReaction(emoji);
    if (isRealRoom) sendReaction(emoji);
  };

  // --- Polls (each returns an error message, or null on success) ---

  const reloadPoll = async () => {
    const roomId = activeRoom.id;
    const activePoll = await fetchActivePoll(roomId, currentUser.id);
    if (activeRoomIdRef.current === roomId) setPoll(activePoll);
  };

  const handleVoteCast = async (optionId: string): Promise<string | null> => {
    if (!poll) return 'There is no active poll.';
    const selectedOption = poll.options.find((o) => o.id === optionId);

    if (isRealRoom) {
      const { error } = await apiVotePoll(activeRoom.code, poll.id, optionId);
      if (error) return error;
      await reloadPoll();
    } else {
      if (poll.userVotedOptionId) return 'You have already voted in this poll.';
      setPoll({
        ...poll,
        options: poll.options.map((o) => (o.id === optionId ? { ...o, votes: o.votes + 1 } : o)),
        totalVotes: poll.totalVotes + 1,
        userVotedOptionId: optionId,
      });
    }
    addToast(`Vote cast for "${selectedOption?.title || 'Selected option'}"!`, 'success');
    return null;
  };

  const handleCreatePoll = async (question: string, options: string[]): Promise<string | null> => {
    if (isRealRoom) {
      const { error } = await apiCreatePoll(activeRoom.code, question, options);
      if (error) return error;
      await reloadPoll();
    } else {
      setPoll({
        id: `poll-${Date.now()}`,
        question,
        options: options.map((title, i) => ({ id: String(i), title, votes: 0 })),
        totalVotes: 0,
        active: true,
      });
    }
    addToast('Poll started!', 'success');
    return null;
  };

  const handleClosePoll = async (): Promise<string | null> => {
    if (!poll) return null;
    if (isRealRoom) {
      const { error } = await apiClosePoll(activeRoom.code, poll.id);
      if (error) return error;
      await reloadPoll();
    } else {
      setPoll(null);
    }
    addToast('Poll closed.', 'info');
    return null;
  };

  // --- Automatic host transfer (server-side connection leases) ---

  // Keep this member's lease alive; if the host's lease expires (closed
  // tab, crash, lost connection) the server hands hosting over.
  useConnectionLease(isRealRoom ? activeRoom.code : null, {
    renew: apiRenewConnectionLease,
    renewOnExit: apiRenewConnectionLeaseOnExit,
  });

  // Guests ask the server whether hosting should move (the server checks
  // the host's lease and picks the successor; Presence only sets the pace)
  useAutoHostTransfer({
    enabled: isRealRoom,
    roomId: activeRoom.id,
    roomCode: activeRoom.code,
    hostId: activeRoom.hostId,
    myId: currentUser.id,
    isHost: currentUser.isHost,
    members,
    onlineIds,
    ask: apiAutoTransferHost,
    onHostChange: applyHostChange,
  });

  useEffect(() => {
    if (!isRealRoom) return;
    const timer = setInterval(() => setPresenceTick(Date.now()), 3_000);
    return () => clearInterval(timer);
  }, [isRealRoom]);

  const hostMissingFor =
    isRealRoom && !currentUser.isHost && realtimeStatus === 'live' && onlineIds !== null && !onlineIds.has(activeRoom.hostId)
      ? presenceTick - hostSeenAt
      : 0;
  const hostIsAway = hostMissingFor > HOST_NOTICE_MS;
  const canClaimManually = hostMissingFor > HOST_MANUAL_TAKEOVER_MS;
  const hostName = members.find((m) => m.id === activeRoom.hostId)?.name ?? 'The host';

  /** Fallback for hosts on older app versions (Stage 3: 3 minutes without activity) */
  const handleClaimHost = async () => {
    const { error } = await apiClaimHost(activeRoom.code);
    if (error) {
      addToast(error, 'warning');
      return;
    }
    applyHostChange(currentUser.id);
    addToast('You are now the host.', 'success');
  };

  // --- Display name ---

  /** Saves the name from the name dialog. Returns an error message, or null. */
  const handleSaveName = async (name: string): Promise<string | null> => {
    const prompt = namePrompt;
    // Renaming inside rooms: update the database first (own rows only)
    if (prompt?.mode === 'edit' && isSupabaseConfigured()) {
      const { error } = await apiUpdateMyDisplayName(name);
      if (error) return error;
    }
    const saved = saveChosenName(name);
    if (!saved) return 'Please enter a valid display name.';
    setCurrentUser((prev) => ({ ...prev, name: saved }));
    setMembers((prev) => prev.map((m) => (m.id === currentUser.id ? { ...m, name: saved } : m)));
    setNamePrompt(null);

    if (prompt?.mode === 'join') {
      await handleJoinRoom(prompt.roomCode, saved);
    } else {
      addToast(`You are now "${saved}".`, 'success');
    }
    return null;
  };

  // Transfer Host Role
  const handleTransferHost = async (targetUserId: string) => {
    const target = members.find((m) => m.id === targetUserId);
    if (!target) return;

    // The server rejects this unless we are the current host
    const { success, error } = await apiTransferRoomHost(activeRoom.code, targetUserId);
    if (!success) {
      addToast(error || 'Failed to transfer host.', 'error');
      return;
    }

    setActiveRoom((prev) => ({ ...prev, hostId: targetUserId }));
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        isHost: m.id === targetUserId,
      }))
    );

    setCurrentUser((prev) => ({
      ...prev,
      isHost: prev.id === targetUserId,
    }));

    addToast(`Host controls transferred to ${target.name}.`, 'info');
  };

  // Toggle Current User Host Role (demo rooms only — in real rooms the
  // database decides who is host)
  const canToggleHostRole = activeRoom.isMockData;
  const handleToggleHostRole = () => {
    if (!canToggleHostRole) return;
    const nextRole = !currentUser.isHost;
    setCurrentUser((prev) => ({ ...prev, isHost: nextRole }));
    setMembers((prev) =>
      prev.map((m) => (m.id === currentUser.id ? { ...m, isHost: nextRole } : m))
    );
    addToast(`Switched mode to ${nextRole ? 'Host (Controls Video)' : 'Spectator (Sync Only)'}`, 'info');
  };

  // Leave room handler
  const handleLeaveRoom = async () => {
    if (!activeRoom.isMockData) {
      const { error } = await apiLeaveRoom(activeRoom.code);
      if (error) {
        addToast(error, 'warning');
      }
      // Back to the local demo room so nothing acts on the room we left
      resetRoomData('demo');
      setActiveRoom(mockRoom);
      setMembers([{ ...currentUser, isHost: false }]);
      setCurrentUser((prev) => ({ ...prev, isHost: false }));
    }

    // Clear room query param from URL
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('room');
    window.history.replaceState({}, '', newUrl.toString());

    setCurrentView('discover');
    addToast('Left screening room.', 'info');
  };

  // Simulate network jitter (demo rooms; real rooms measure real drift)
  const handleSimulateDrift = () => {
    const randomDrift = Math.floor(Math.random() * 320) + 15;
    setDriftMs(randomDrift);
    if (randomDrift > 250) {
      addToast(`Drift jitter alert: ${randomDrift}ms (Auto-correcting within 500ms target)`, 'warning');
    } else {
      addToast(`Drift check: ${randomDrift}ms (Optimal sync)`, 'info');
    }
  };

  return (
    <div className="min-h-screen bg-[#06070B] text-slate-100 selection:bg-violet-500/30 selection:text-white flex flex-col justify-between">
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />

      {/* Main Navigation Bar */}
      <Navbar
        currentView={currentView}
        onNavigate={setCurrentView}
        currentUser={currentUser}
        activeRoom={activeRoom}
        onOpenCreateModal={() => {
          setSelectedMovieForCreate(undefined);
          setIsCreateModalOpen(true);
        }}
        onOpenJoinModal={() => setIsJoinModalOpen(true)}
        onToggleHostRole={handleToggleHostRole}
        canToggleHostRole={canToggleHostRole}
        onEditName={() => setNamePrompt({ mode: 'edit' })}
      />

      {/* Backend Status Notice */}
      {!isSupabaseConfigured() && (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-center text-xs text-amber-300">
          <span>⚡ Stage 3 Architecture Ready: Supabase schema & real-time client connected. Run the SQL migration below to enable live multi-user database persistence!</span>
        </div>
      )}

      {/* Main View Screen */}
      <main className="flex-1">
        {currentView === 'discover' ? (
          <div>
            {/* Cinematic Hero */}
            <DiscoverHero
              featuredMovies={mockMovies.filter((m) => m.featured)}
              onPlayMovieInRoom={handlePlayMovie}
              onOpenCreateModalWithMovie={(m) => {
                setSelectedMovieForCreate(m.id);
                setIsCreateModalOpen(true);
              }}
            />

            {/* Catalog Grid with Search, Categories & Sorting */}
            <MovieGrid
              movies={mockMovies}
              onPlayMovie={handlePlayMovie}
              onAddToPlaylist={handleAddToPlaylist}
            />

            {/* Collapsible Architecture & Quality Targets Spec Card */}
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
              <div className="rounded-2xl border border-white/[0.08] bg-[#0A0C13] p-4 text-center">
                <button
                  type="button"
                  onClick={() => setShowArchBenchmark((prev) => !prev)}
                  className="text-xs font-semibold text-violet-300 hover:text-white transition-colors"
                >
                  {showArchBenchmark ? '▲ Hide Quality Targets & Stage Verification Bench' : '▼ View Sync Latency Targets (<250ms) & Verification Checklist'}
                </button>
                {showArchBenchmark && (
                  <div className="mt-4 pt-4 border-t border-white/[0.06] text-left">
                    <Suspense fallback={<SectionLoader label="Loading checklist…" />}>
                    <StageOverview
                      room={activeRoom}
                      currentUser={currentUser}
                      members={displayedMembers}
                      driftMs={driftMs}
                      onSimulateDrift={handleSimulateDrift}
                      onToggleHostRole={handleToggleHostRole}
                      canToggleHostRole={canToggleHostRole}
                    />
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Watch Room View Screen */
          <Suspense fallback={<SectionLoader label="Opening the screening room…" />}>
          <WatchRoomScreen
            room={activeRoom}
            currentMovie={displayedMovie}
            currentUser={currentUser}
            members={displayedMembers}
            playlist={playlist}
            chatMessages={chatMessages}
            poll={poll}
            driftMs={driftMs}
            onLeaveRoom={handleLeaveRoom}
            onSelectMovieFromPlaylist={(item) => {
              const matched = mockMovies.find((m) => m.id === item.movieId);
              if (matched) void handlePlayMovie(matched);
            }}
            onRemoveFromPlaylist={handleRemoveFromPlaylist}
            onMovePlaylistItem={handleMovePlaylistItem}
            onSendMessage={handleSendMessage}
            onTriggerReaction={handleTriggerReaction}
            onVoteCast={handleVoteCast}
            onCreatePoll={handleCreatePoll}
            onClosePoll={handleClosePoll}
            onTransferHost={handleTransferHost}
            onSimulateDrift={handleSimulateDrift}
            onOpenDiscover={() => setCurrentView('discover')}
            floatingReactions={floatingReactions}
            playbackSync={isRealRoom ? {
              playback,
              clockOffsetMs,
              serverDelayMs,
              onHostChange: (state) => void handleHostPlaybackChange(state),
            } : undefined}
            connectionStatus={realtimeStatus}
            hostAway={hostIsAway ? { hostName, canClaim: canClaimManually } : null}
            onClaimHost={() => void handleClaimHost()}
          />
          </Suspense>
        )}
      </main>

      {/* Modals (mounted fresh on each open, so forms and the preselected movie reset) */}
      <Suspense fallback={null}>
        {isCreateModalOpen && (
          <CreateRoomModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            movies={mockMovies}
            selectedMovieId={selectedMovieForCreate}
            defaultHostName={getChosenName()}
            onCreateRoom={handleCreateRoom}
          />
        )}

        {isJoinModalOpen && (
          <JoinRoomModal
            isOpen={isJoinModalOpen}
            onClose={() => setIsJoinModalOpen(false)}
            onJoinRoom={handleJoinRoom}
          />
        )}
        {namePrompt && (
          <NameModal
            mode={namePrompt.mode}
            initialName={getChosenName()}
            onClose={() => setNamePrompt(null)}
            onSave={handleSaveName}
          />
        )}
      </Suspense>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] bg-[#06070B] py-6 text-xs text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
          <p>
            🎬 <span className="font-semibold text-slate-300">Watch Party</span> • College Club Selection Project
          </p>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Supabase JS Client Active</span>
            <span>•</span>
            <span>RLS Protected</span>
            <span>•</span>
            <span>Multi-Session Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
