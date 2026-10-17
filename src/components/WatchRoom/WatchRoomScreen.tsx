import { useMemo, useRef, useState } from 'react';
import { MessageSquare, Users, Smile, ListVideo, Vote, MonitorPlay } from 'lucide-react';
import type { Room, User, Movie, PlaylistItem, ChatMessage, Poll, FloatingReaction } from '../../types';
import type { RealtimeStatus } from '../../hooks/useRoomRealtime';
import { REACTION_EMOJIS } from '../../lib/reactions';
import { VideoPlayer, type PlaybackSyncProps } from './VideoPlayer';
import { ChatPanel } from './ChatPanel';
import { PlaylistPanel } from './PlaylistPanel';
import { PollPanel } from './PollPanel';
import { ParticipantsList } from './ParticipantsList';
import { FloatingReactions } from './FloatingReactions';
import { LeaveRoomDialog } from './LeaveRoomDialog';
import { AddYouTubeDialog } from './AddYouTubeDialog';
import { RoomHeader } from './RoomHeader';
import { Artwork } from '../ui/Artwork';

interface WatchRoomScreenProps {
  room: Room;
  currentMovie: Movie;
  currentUser: User;
  members: User[];
  playlist: PlaylistItem[];
  chatMessages: ChatMessage[];
  poll: Poll | null;
  driftMs: number;
  /** Host: add a YouTube video to the queue or play it now (error message or null) */
  onAddYouTube?: (video: { videoId: string; title: string }, action: 'queue' | 'play') => Promise<string | null>;
  /** Leaves the room; resolves to an error message, or null when done */
  onLeaveRoom: () => Promise<string | null>;
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
  /** Opens the "change your name" dialog */
  onEditName?: () => void;
  /** Demo rooms only: switch between host and viewer */
  onToggleHostRole?: () => void;
  floatingReactions: FloatingReaction[];
  /** Shared playback wiring (real rooms only) */
  playbackSync?: PlaybackSyncProps;
  connectionStatus: RealtimeStatus;
  /** Set when the host has disconnected (guests only); canClaim = manual fallback */
  hostAway?: { hostName: string; canClaim: boolean } | null;
  onClaimHost?: () => void;
}

type TabType = 'chat' | 'people' | 'reactions' | 'playlist' | 'poll';

const REACTION_NAMES: Record<string, string> = {
  '🔥': 'Fire', '❤️': 'Love', '🍿': 'Popcorn', '🚀': 'Rocket', '😱': 'Shocked', '👏': 'Applause',
};

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
  onAddYouTube,
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
  onEditName,
  onToggleHostRole,
  floatingReactions,
  playbackSync,
  connectionStatus,
  hostAway,
  onClaimHost,
}: WatchRoomScreenProps) {
  const [activeTab, setActiveTab] = useState<TabType>('chat');

  // Leave confirmation. The ref blocks a second request at once (state
  // updates only on the next render, so a quick double click could
  // otherwise send two).
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const leavingRef = useRef(false);
  const [isYouTubeDialogOpen, setIsYouTubeDialogOpen] = useState(false);

  const openLeaveDialog = () => {
    setLeaveError('');
    setIsLeaveDialogOpen(true);
  };

  const confirmLeave = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setIsLeaving(true);
    setLeaveError('');
    const error = await onLeaveRoom();
    leavingRef.current = false;
    setIsLeaving(false);
    // On success this screen is replaced by the home screen
    if (error) setLeaveError(error);
  };
  const [copiedLink, setCopiedLink] = useState(false);

  // Everyone's current name, so chat and the queue show renamed people correctly
  const nameById = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const onlineCount = members.filter((m) => m.isOnline !== false).length;

  const tabs: { id: TabType; label: string; icon: typeof MessageSquare }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'people', label: 'Participants', icon: Users },
    { id: 'reactions', label: 'Reactions', icon: Smile },
    { id: 'playlist', label: `Queue (${playlist.length})`, icon: ListVideo },
    { id: 'poll', label: 'Polls', icon: Vote },
  ];

  const handleCopyInviteLink = async () => {
    const inviteUrl = `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // clipboard blocked: the code stays visible in the header
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  const isYouTube = currentMovie.source === 'youtube';

  return (
    <>
      <RoomHeader
        room={room}
        currentUser={currentUser}
        onlineCount={onlineCount}
        memberCount={members.length}
        connectionStatus={connectionStatus}
        copiedLink={copiedLink}
        onCopyInvite={() => void handleCopyInviteLink()}
        onOpenDiscover={onOpenDiscover}
        onLeave={openLeaveDialog}
        onEditName={onEditName}
        onToggleHostRole={onToggleHostRole}
      />

      <div className="mx-auto w-full max-w-[1440px] px-3 pb-10 pt-4 sm:px-6 sm:pt-5">
        {/* The host disappeared (closed laptop, lost connection) */}
        {hostAway && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-muted/40 bg-gold/[0.06] px-4 py-3 text-xs text-ivory/90"
          >
            <span>
              <strong className="font-semibold text-gold">{hostAway.hostName}</strong> (host) disconnected. If they do not come back
              within a few seconds, hosting passes automatically to the next person in the room.
            </span>
            {onClaimHost && hostAway.canClaim && (
              <button type="button" onClick={onClaimHost} className="btn-gold h-8 px-3 text-xs">
                Take over hosting
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
          {/* Player and quick reactions */}
          <div className="min-w-0 space-y-3">
            <div className="relative">
              <VideoPlayer
                // A fresh player when switching between files and YouTube videos
                key={isYouTube ? currentMovie.id : 'file'}
                movie={currentMovie}
                isHost={currentUser.isHost}
                room={room}
                currentUser={currentUser}
                driftMs={driftMs}
                onSimulateDrift={onSimulateDrift}
                sync={playbackSync}
              />
              <FloatingReactions reactions={floatingReactions} />
            </div>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick reactions">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onTriggerReaction(emoji)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-bronze bg-surface text-xl transition-[transform,border-color] hover:-translate-y-0.5 hover:border-gold-muted active:scale-95"
                  title={`Send ${emoji} reaction`}
                  aria-label={`Send ${emoji} reaction`}
                >
                  {emoji}
                </button>
              ))}
              <span className="ml-1 hidden text-[11px] text-ash sm:inline">Reactions float over everyone's screen</span>
            </div>
          </div>

          {/* Room panels; on large screens exactly as tall as the player column */}
          <aside className="relative h-[540px] lg:h-auto" aria-label="Chat and room tools">
            <div className="panel flex h-full flex-col overflow-hidden rounded-2xl lg:absolute lg:inset-0">
              <div
                className="no-scrollbar flex shrink-0 overflow-x-auto border-b border-bronze-soft px-2"
                role="tablist"
                aria-label="Room panels"
              >
                {tabs.map((tab, i) => {
                  const selected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      id={`room-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="room-tab-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      onKeyDown={(e) => {
                        const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: tabs.length - 1, Home: -i, End: tabs.length - 1 - i };
                        if (!(e.key in keys)) return;
                        e.preventDefault();
                        const next = tabs[(i + keys[e.key] + tabs.length) % tabs.length];
                        setActiveTab(next.id);
                        document.getElementById(`room-tab-${next.id}`)?.focus();
                      }}
                      className={`relative flex shrink-0 grow items-center justify-center px-3 py-3.5 text-xs transition-colors sm:px-2.5 ${
                        selected ? 'font-semibold text-gold' : 'text-ash hover:text-ivory'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        aria-hidden="true"
                        className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gold transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}
                      />
                    </button>
                  );
                })}
              </div>

              <div
                className="min-h-0 flex-1 overflow-hidden"
                id="room-tab-panel"
                role="tabpanel"
                aria-labelledby={`room-tab-${activeTab}`}
              >
                {activeTab === 'chat' && (
                  <ChatPanel
                    messages={chatMessages}
                    currentUser={currentUser}
                    onSendMessage={onSendMessage}
                    nameById={nameById}
                    hostId={room.hostId}
                  />
                )}

                {activeTab === 'people' && (
                  <ParticipantsList
                    variant="list"
                    members={members}
                    currentUserId={currentUser.id}
                    isHost={currentUser.isHost}
                    onTransferHost={onTransferHost}
                    onInvite={() => void handleCopyInviteLink()}
                    inviteCopied={copiedLink}
                  />
                )}

                {activeTab === 'reactions' && (
                  <div className="flex h-full flex-col p-4">
                    <h3 className="text-sm font-semibold text-ivory">Reactions</h3>
                    <p className="mt-1 text-xs text-ash">Tap to send. They float over the screen for everyone in the room.</p>
                    <div className="mt-4 grid grid-cols-3 gap-2.5">
                      {REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => onTriggerReaction(emoji)}
                          className="flex flex-col items-center gap-1 rounded-xl border border-bronze bg-ink/40 py-3 transition-colors hover:border-gold-muted hover:bg-gold/[0.05] active:scale-95"
                          aria-label={`Send ${emoji} reaction`}
                        >
                          <span className="text-2xl" aria-hidden="true">{emoji}</span>
                          <span className="text-[11px] text-ash">{REACTION_NAMES[emoji] ?? ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>
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
                    onAddYouTube={onAddYouTube ? () => setIsYouTubeDialogOpen(true) : undefined}
                  />
                )}

                {activeTab === 'poll' && (
                  <div className="h-full overflow-y-auto">
                    <PollPanel
                      key={poll?.id ?? 'no-poll'}
                      poll={poll}
                      isHost={currentUser.isHost}
                      onVoteCast={onVoteCast}
                      onCreatePoll={onCreatePoll}
                      onClosePoll={onClosePoll}
                    />
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Now watching and the people in the room */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:col-span-2">
            <section aria-label="Now watching" className="panel flex min-w-0 items-center gap-4 rounded-2xl p-3">
              <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-bronze bg-surface-2 sm:w-32">
                <Artwork sources={[currentMovie.posterUrl, currentMovie.backdropUrl]} alt="" className="h-full w-full object-cover" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-ash">Now Watching</p>
                <p className="truncate font-display text-lg font-medium text-ivory" title={currentMovie.title}>
                  {currentMovie.title}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-ash">
                  {isYouTube ? (
                    <span className="inline-flex items-center gap-1 text-ivory/85">
                      <MonitorPlay className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                      YouTube video
                    </span>
                  ) : (
                    <>
                      {currentMovie.year > 0 && <span>{currentMovie.year}</span>}
                      {currentMovie.duration && <span>{currentMovie.duration}</span>}
                      {currentMovie.category && <span>{currentMovie.category}</span>}
                    </>
                  )}
                </p>
                {currentMovie.videoCredit && (
                  <p className="mt-0.5 truncate text-[10px] text-ash-muted" title={currentMovie.videoCredit}>
                    Video: {currentMovie.videoCredit}
                  </p>
                )}
              </div>
            </section>

            <ParticipantsList
              members={members}
              currentUserId={currentUser.id}
              isHost={currentUser.isHost}
              onTransferHost={onTransferHost}
              onInvite={() => void handleCopyInviteLink()}
              inviteCopied={copiedLink}
            />
          </div>
        </div>
      </div>

      {isYouTubeDialogOpen && onAddYouTube && (
        <AddYouTubeDialog onClose={() => setIsYouTubeDialogOpen(false)} onAdd={onAddYouTube} />
      )}

      {isLeaveDialogOpen && (
        <LeaveRoomDialog
          isHost={currentUser.isHost}
          isLeaving={isLeaving}
          error={leaveError}
          onCancel={() => setIsLeaveDialogOpen(false)}
          onConfirm={() => void confirmLeave()}
        />
      )}
    </>
  );
}
