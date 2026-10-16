import { useMemo, useState } from 'react';
import { 
  ArrowLeft, 
  Copy, 
  Check, 
  MessageSquare, 
  ListMusic, 
  Vote 
} from 'lucide-react';
import type { Room, User, Movie, PlaylistItem, ChatMessage, Poll, FloatingReaction } from '../../types';
import type { RealtimeStatus } from '../../hooks/useRoomRealtime';
import { VideoPlayer, type PlaybackSyncProps } from './VideoPlayer';
import { ChatPanel } from './ChatPanel';
import { PlaylistPanel } from './PlaylistPanel';
import { PollPanel } from './PollPanel';
import { ParticipantsList } from './ParticipantsList';
import { FloatingReactions } from './FloatingReactions';

interface WatchRoomScreenProps {
  room: Room;
  currentMovie: Movie;
  currentUser: User;
  members: User[];
  playlist: PlaylistItem[];
  chatMessages: ChatMessage[];
  poll: Poll | null;
  driftMs: number;
  onLeaveRoom: () => void;
  onSelectMovieFromPlaylist: (item: PlaylistItem) => void;
  onRemoveFromPlaylist: (item: PlaylistItem) => void;
  onMovePlaylistItem: (item: PlaylistItem, direction: -1 | 1) => void;
  onSendMessage: (text: string) => void;
  onTriggerReaction: (emoji: string) => void;
  onVoteCast: (optionId: string) => Promise<string | null>;
  onCreatePoll: (question: string, options: string[]) => Promise<string | null>;
  onClosePoll: () => Promise<string | null>;
  onTransferHost: (targetUserId: string) => void;
  onSimulateDrift: () => void;
  onOpenDiscover: () => void;
  floatingReactions: FloatingReaction[];
  /** Shared playback wiring (real rooms only) */
  playbackSync?: PlaybackSyncProps;
  connectionStatus: RealtimeStatus;
  /** Set when the host has disconnected (guests only); canClaim = manual fallback */
  hostAway?: { hostName: string; canClaim: boolean } | null;
  onClaimHost?: () => void;
}

type TabType = 'chat' | 'playlist' | 'poll';

export function WatchRoomScreen({
  room,
  currentMovie,
  currentUser,
  members,
  playlist,
  chatMessages,
  poll,
  driftMs,
  onLeaveRoom,
  onSelectMovieFromPlaylist,
  onRemoveFromPlaylist,
  onMovePlaylistItem,
  onSendMessage,
  onTriggerReaction,
  onVoteCast,
  onCreatePoll,
  onClosePoll,
  onTransferHost,
  onSimulateDrift,
  onOpenDiscover,
  floatingReactions,
  playbackSync,
  connectionStatus,
  hostAway,
  onClaimHost,
}: WatchRoomScreenProps) {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [copiedLink, setCopiedLink] = useState(false);

  // Everyone's current name, so chat and the queue show renamed people correctly
  const nameById = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  const tabs: { id: TabType; label: string; icon: typeof MessageSquare }[] = [
    { id: 'chat', label: 'Live Chat', icon: MessageSquare },
    { id: 'playlist', label: `Queue (${playlist.length})`, icon: ListMusic },
    { id: 'poll', label: 'Club Poll', icon: Vote },
  ];

  const handleCopyInviteLink = async () => {
    const inviteUrl = `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Top Room Banner Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0A0C13] p-4 shadow-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onLeaveRoom}
            aria-label="Leave the room and go back to the library"
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Library</span>
          </button>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-bold text-white sm:text-lg tracking-tight">
                {room.name}
              </h1>
              <span className="rounded-md bg-white/[0.05] border border-white/[0.08] px-2 py-0.5 text-[10px] font-bold text-slate-300">
                {room.isPrivate ? 'Private Room' : 'Public Screening'}
              </span>
              {room.isMockData && (
                <span className="rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  Offline / Local Mode
                </span>
              )}
              {connectionStatus === 'reconnecting' && (
                <span className="rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  Reconnecting…
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate max-w-md">
              Screening: <span className="text-slate-200 font-semibold">{currentMovie.title}</span> ({currentMovie.year})
            </p>
            {currentMovie.videoCredit && (
              <p className="text-[10px] text-slate-500 truncate max-w-md" title={currentMovie.videoCredit}>
                Video: {currentMovie.videoCredit}
              </p>
            )}
          </div>
        </div>

        {/* Room Code & Copy Invite Link */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyInviteLink}
            className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-950/20 px-3.5 py-2 font-mono text-xs text-violet-200 hover:bg-violet-900/30 transition-colors"
            title="Click to copy full invite link for sharing"
          >
            <span className="text-violet-400 font-semibold">CODE:</span>
            <span className="font-bold">{room.code}</span>
            {copiedLink ? (
              <span className="text-emerald-400 font-sans text-xs flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                Invite Link Copied!
              </span>
            ) : (
              <Copy className="h-3.5 w-3.5 text-violet-400" />
            )}
          </button>
        </div>
      </div>

      {/* The host disappeared (closed laptop, lost connection) */}
      {hostAway && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200"
        >
          <span>
            <strong className="font-semibold">{hostAway.hostName}</strong> (host) disconnected. If they do not come back
            within a few seconds, hosting passes automatically to the next person in the room.
          </span>
          {onClaimHost && hostAway.canClaim && (
            <button
              type="button"
              onClick={onClaimHost}
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-500/20 transition-colors"
            >
              Take over hosting
            </button>
          )}
        </div>
      )}

      {/* Main Cinema Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Columns: Video Player & Participants */}
        <div className="space-y-5 lg:col-span-2">
          {/* Cinema Frame with floating reactions */}
          <div className="relative">
            <VideoPlayer
              movie={currentMovie}
              isHost={currentUser.isHost}
              room={room}
              currentUser={currentUser}
              driftMs={driftMs}
              onSimulateDrift={onSimulateDrift}
              sync={playbackSync}
            />
            {/* Smooth floating reactions overlay */}
            <FloatingReactions reactions={floatingReactions} />
          </div>

          {/* Active Members row */}
          <ParticipantsList
            members={members}
            currentUserId={currentUser.id}
            isHost={currentUser.isHost}
            onTransferHost={onTransferHost}
          />
        </div>

        {/* Right 1 Column: Interactive Cinema Multi-Tab Side Panel */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0A0C13] shadow-2xl h-[520px] lg:h-[590px]">
          {/* Unified Tab Navigation (arrow keys move between tabs) */}
          <div className="flex border-b border-white/[0.06] bg-[#07080E]" role="tablist" aria-label="Room panels">
            {tabs.map((tab, i) => (
              <button
                key={tab.id}
                id={`room-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls="room-tab-panel"
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                  setActiveTab(next.id);
                  document.getElementById(`room-tab-${next.id}`)?.focus();
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-semibold tracking-wide transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-violet-500 text-white bg-white/[0.02]'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <tab.icon className="h-3.5 w-3.5 text-violet-400" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Active Tab Panel */}
          <div
            className="flex-1 overflow-hidden"
            id="room-tab-panel"
            role="tabpanel"
            aria-labelledby={`room-tab-${activeTab}`}
          >
            {activeTab === 'chat' && (
              <ChatPanel
                messages={chatMessages}
                currentUser={currentUser}
                onSendMessage={onSendMessage}
                onTriggerReaction={onTriggerReaction}
                nameById={nameById}
              />
            )}

            {activeTab === 'playlist' && (
              <PlaylistPanel
                playlist={playlist}
                currentMovieId={currentMovie.id}
                isHost={currentUser.isHost}
                onSelectMovie={onSelectMovieFromPlaylist}
                onOpenDiscover={onOpenDiscover}
                onRemoveItem={onRemoveFromPlaylist}
                onMoveItem={onMovePlaylistItem}
                nameById={nameById}
              />
            )}

            {activeTab === 'poll' && (
              <PollPanel
                key={poll?.id ?? 'no-poll'}
                poll={poll}
                isHost={currentUser.isHost}
                onVoteCast={onVoteCast}
                onCreatePoll={onCreatePoll}
                onClosePoll={onClosePoll}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
