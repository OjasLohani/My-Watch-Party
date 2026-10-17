import { ArrowRightLeft, Plus, Check, Crown } from 'lucide-react';
import type { User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface ParticipantsListProps {
  members: User[];
  currentUserId: string;
  isHost: boolean;
  onTransferHost: (targetUserId: string) => void;
  /** strip: compact row under the player; list: full panel with host actions */
  variant?: 'strip' | 'list';
  onInvite?: () => void;
  inviteCopied?: boolean;
}

/** Host first, then online people, then the rest (in join order) */
function ordered(members: User[]) {
  return [...members].sort((a, b) =>
    Number(b.isHost) - Number(a.isHost) || Number(b.isOnline !== false) - Number(a.isOnline !== false));
}

export function ParticipantsList({
  members,
  currentUserId,
  isHost,
  onTransferHost,
  variant = 'strip',
  onInvite,
  inviteCopied = false,
}: ParticipantsListProps) {
  const onlineCount = members.filter((m) => m.isOnline !== false).length;
  const people = ordered(members);

  const inviteButton = onInvite && (
    <button
      type="button"
      onClick={onInvite}
      className={variant === 'list'
        ? 'btn-ghost h-10 w-full border-bronze text-sm'
        : 'flex shrink-0 flex-col items-center gap-1 text-[11px] text-ash transition-colors hover:text-gold'}
      aria-label={inviteCopied ? 'Invite link copied' : 'Invite friends: copy the invite link'}
    >
      {variant === 'list' ? (
        <>
          {inviteCopied ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {inviteCopied ? 'Invite link copied' : 'Invite Friends'}
        </>
      ) : (
        <>
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-bronze">
            {inviteCopied ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          </span>
          {inviteCopied ? 'Copied' : 'Invite'}
        </>
      )}
    </button>
  );

  if (variant === 'list') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h3 className="text-sm font-semibold text-ivory">Room Participants</h3>
          <span className="text-xs font-medium text-success">{onlineCount}/{members.length} Online</span>
        </div>
        <ul className="flex-1 space-y-1 overflow-y-auto px-2">
          {people.map((member) => {
            const isMe = member.id === currentUserId;
            const online = member.isOnline !== false;
            return (
              <li key={member.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[0.02]">
                <Avatar name={member.name} src={member.avatar} color={member.color} size={38} online={online} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ivory">
                    <span className="truncate" title={member.name}>{member.name}</span>
                    {isMe && <span className="shrink-0 text-xs font-normal text-ash">(You)</span>}
                    {member.isHost && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" aria-label="Host" />}
                  </p>
                  <p className={`text-xs ${member.isHost ? 'text-gold-muted' : online ? 'text-success' : 'text-ash-muted'}`}>
                    {member.isHost ? 'Host' : online ? 'Online' : 'Offline'}
                  </p>
                </div>
                {isHost && !member.isHost && (
                  <button
                    type="button"
                    onClick={() => onTransferHost(member.id)}
                    title={`Make ${member.name} the host`}
                    aria-label={`Transfer host to ${member.name}`}
                    className="btn-icon h-8 shrink-0 gap-1 rounded-md px-2 text-[11px]"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Make host</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {inviteButton && <div className="border-t border-bronze-soft p-3">{inviteButton}</div>}
      </div>
    );
  }

  return (
    <div className="panel min-w-0 rounded-2xl px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-ivory">Room Participants</h3>
        <span className="text-[11px] text-success">{onlineCount} Online</span>
      </div>
      <div className="no-scrollbar mt-2.5 flex items-start gap-4 overflow-x-auto pb-1">
        {people.map((member) => {
          const isMe = member.id === currentUserId;
          const online = member.isOnline !== false;
          return (
            <div key={member.id} className="flex shrink-0 items-center gap-2.5">
              <Avatar name={member.name} src={member.avatar} color={member.color} size={36} online={online} isHost={member.isHost} />
              <div className="max-w-[9.5rem]">
                <div className="flex items-center gap-1 text-xs font-medium text-ivory">
                  <span className="truncate" title={member.name}>{member.name}</span>{' '}
                  {isMe && <span className="shrink-0 text-[10px] font-normal text-ash">(You)</span>}
                </div>
                <div className={`text-[11px] ${member.isHost ? 'text-gold-muted' : online ? 'text-ash' : 'text-ash-muted'}`}>
                  {member.isHost ? 'Host' : online ? 'Online' : 'Offline'}
                </div>
              </div>
            </div>
          );
        })}
        {inviteButton}
      </div>
    </div>
  );
}
