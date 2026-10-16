import { Shield, ArrowRightLeft, Users } from 'lucide-react';
import type { User } from '../../types';

interface ParticipantsListProps {
  members: User[];
  currentUserId: string;
  isHost: boolean;
  onTransferHost: (targetUserId: string) => void;
}

export function ParticipantsList({
  members,
  currentUserId,
  isHost,
  onTransferHost,
}: ParticipantsListProps) {
  const onlineCount = members.filter((m) => m.isOnline !== false).length;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0A0C13] p-4">
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-400" />
          <h3 className="text-xs font-bold text-white tracking-wide">
            Room Participants
          </h3>
          <span className="rounded-full bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-[10px] font-mono text-emerald-300">
            {onlineCount} Online
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">
          Target: 10+ concurrent
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2.5">
        {members.map((member) => {
          const isCurrentUser = member.id === currentUserId;
          const isOnline = member.isOnline !== false;

          return (
            <div
              key={member.id}
              className={`flex items-center gap-2.5 rounded-xl border p-2 transition-all ${
                member.isHost
                  ? 'border-violet-500/30 bg-violet-950/20'
                  : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              {/* Avatar with presence indicator */}
              <div className="relative">
                <img
                  src={member.avatar}
                  alt={member.name}
                  className="h-8 w-8 rounded-full object-cover border border-white/20"
                  onError={(e) => {
                    e.currentTarget.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
                  }}
                />
                {/* Live presence indicator */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0A0C13] ${
                    isOnline ? 'bg-emerald-400' : 'bg-slate-500'
                  }`}
                  title={isOnline ? 'Online now' : 'Away / Disconnected'}
                />
                {member.isHost && (
                  <span
                    className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-black shadow"
                    title="Room Host"
                  >
                    <Shield className="h-2.5 w-2.5 fill-black" />
                  </span>
                )}
              </div>

              {/* Name & Role */}
              <div className="text-left">
                <div className="text-xs font-bold text-white flex items-center gap-1">
                  {member.name} {isCurrentUser && <span className="text-slate-400 font-normal text-[10px]">(You)</span>}
                </div>
                <div className="text-[10px] text-slate-400 flex items-center gap-1">
                  <span>{member.isHost ? 'Host' : 'Spectator'}</span>
                  <span>•</span>
                  <span className={isOnline ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>

              {/* Host Transfer Action */}
              {isHost && !member.isHost && (
                <button
                  type="button"
                  onClick={() => onTransferHost(member.id)}
                  title={`Transfer host controls to ${member.name}`}
                  className="ml-1 rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-slate-400 hover:text-violet-300 hover:border-violet-500/30 hover:bg-violet-950/30 transition-colors"
                  aria-label={`Transfer host to ${member.name}`}
                >
                  <ArrowRightLeft className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
