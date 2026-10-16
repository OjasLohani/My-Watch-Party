import { useState } from 'react';
import { 
  ArrowLeft, 
  Copy, 
  Check, 
  MessageSquare, 
  ListMusic, 
  Vote 
} from 'lucide-react';
import type { Room, User, Movie, PlaylistItem, ChatMessage, Poll, FloatingReaction } from '../../types';
import { VideoPlayer } from './VideoPlayer';
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
  initialPoll: Poll;
  driftMs: number;
  onLeaveRoom: () => void;
  onSelectMovieFromPlaylist: (item: PlaylistItem) => void;
  onSendMessage: (text: string) => void;
  onTriggerReaction: (emoji: string) => void;
  onVoteCast: (optionId: string) => void;
  onTransferHost: (targetUserId: string) => void;
  onSimulateDrift: () => void;
  onOpenDiscover: () => void;
  floatingReactions: FloatingReaction[];
}

type TabType = 'chat' | 'playlist' | 'poll';

export function WatchRoomScreen({
  room,
  currentMovie,
  currentUser,
  members,
  playlist,
  chatMessages,
  initialPoll,
  driftMs,
  onLeaveRoom,
  onSelectMovieFromPlaylist,
  onSendMessage,
  onTriggerReaction,
  onVoteCast,
  onTransferHost,
  onSimulateDrift,
  onOpenDiscover,
  floatingReactions,
}: WatchRoomScreenProps) {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [copiedLink, setCopiedLink] = useState(false);

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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLeaveRoom}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Library</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white sm:text-lg tracking-tight">
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
            </div>
            <p className="text-xs text-slate-400 truncate max-w-md">
              Screening: <span className="text-slate-200 font-semibold">{currentMovie.title}</span> ({currentMovie.year})
            </p>
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
        <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0A0C13] shadow-2xl h-[590px]">
          {/* Unified Tab Navigation */}
          <div className="flex border-b border-white/[0.06] bg-[#07080E]">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-semibold tracking-wide transition-all border-b-2 ${
                activeTab === 'chat'
                  ? 'border-violet-500 text-white bg-white/[0.02]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
              <span>Live Chat</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('playlist')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-semibold tracking-wide transition-all border-b-2 ${
                activeTab === 'playlist'
                  ? 'border-violet-500 text-white bg-white/[0.02]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListMusic className="h-3.5 w-3.5 text-violet-400" />
              <span>Queue ({playlist.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('poll')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-semibold tracking-wide transition-all border-b-2 ${
                activeTab === 'poll'
                  ? 'border-violet-500 text-white bg-white/[0.02]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Vote className="h-3.5 w-3.5 text-violet-400" />
              <span>Club Poll</span>
            </button>
          </div>

          {/* Active Tab Panel */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'chat' && (
              <ChatPanel
                messages={chatMessages}
                currentUser={currentUser}
                onSendMessage={onSendMessage}
                onTriggerReaction={onTriggerReaction}
              />
            )}

            {activeTab === 'playlist' && (
              <PlaylistPanel
                playlist={playlist}
                currentMovieId={currentMovie.id}
                isHost={currentUser.isHost}
                onSelectMovie={onSelectMovieFromPlaylist}
                onOpenDiscover={onOpenDiscover}
              />
            )}

            {activeTab === 'poll' && (
              <PollPanel
                initialPoll={initialPoll}
                onVoteCast={onVoteCast}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
