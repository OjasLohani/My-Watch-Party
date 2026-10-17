import { useEffect, useRef, useState } from 'react';
import { Link2, Check, Settings, LogOut, Users, Pencil, ArrowLeft, Copy, Lock, Globe, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { Room, User } from '../../types';
import type { RealtimeStatus } from '../../hooks/useRoomRealtime';
import { Logo } from '../ui/Logo';
import { Avatar } from '../ui/Avatar';

interface RoomHeaderProps {
  room: Room;
  currentUser: User;
  onlineCount: number;
  memberCount: number;
  connectionStatus: RealtimeStatus;
  copiedLink: boolean;
  onCopyInvite: () => void;
  onOpenDiscover: () => void;
  onLeave: () => void;
  onEditName?: () => void;
  /** Demo rooms only: switch between host and viewer */
  onToggleHostRole?: () => void;
}

/** Compact theater header: logo, room, people, invite, settings, leave */
export function RoomHeader({
  room,
  currentUser,
  onlineCount,
  memberCount,
  connectionStatus,
  copiedLink,
  onCopyInvite,
  onOpenDiscover,
  onLeave,
  onEditName,
  onToggleHostRole,
}: RoomHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close the settings popover on outside click / Escape
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        settingsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
    } catch {
      // clipboard blocked: the code is shown in the panel anyway
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const connection = room.isMockData
    ? { icon: WifiOff, label: 'Local demo room (this browser only)', tone: 'text-gold-muted' }
    : connectionStatus === 'live'
      ? { icon: Wifi, label: 'Connected live', tone: 'text-success' }
      : connectionStatus === 'reconnecting'
        ? { icon: RefreshCw, label: 'Reconnecting…', tone: 'text-gold' }
        : { icon: Wifi, label: 'Connecting…', tone: 'text-ash' };

  return (
    <nav aria-label="Room" className="sticky top-0 z-40 border-b border-bronze-soft bg-ink/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={onOpenDiscover}
          aria-label="Browse the library (you stay in the room)"
          title="Browse the library. You stay in the room; use Leave Room to leave."
          className="flex shrink-0 items-center gap-1.5 rounded-md pr-1 text-ash transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4 sm:hidden" aria-hidden="true" />
          <Logo />
        </button>

        <span className="hidden h-6 w-px bg-bronze-soft sm:block" aria-hidden="true" />

        {/* Room name and status */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-ivory sm:text-[15px]" title={room.name}>
            {room.name}
          </h1>
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-bronze px-2 py-0.5 text-[11px] text-ivory/85"
            title={`${onlineCount} of ${memberCount} people online`}
          >
            <Users className="h-3 w-3 text-gold-muted" aria-hidden="true" />
            {onlineCount}/{memberCount}
            <span className="sr-only">people online</span>
          </span>
          {room.isMockData && (
            <span className="hidden shrink-0 rounded-full border border-gold-muted/40 px-2 py-0.5 text-[10px] text-gold-muted md:inline">
              Offline / Local Mode
            </span>
          )}
          {connectionStatus === 'reconnecting' && (
            <span className="shrink-0 rounded-full border border-gold/40 px-2 py-0.5 text-[10px] text-gold" role="status">
              Reconnecting…
            </span>
          )}
        </div>

        {/* Invite link */}
        <button
          type="button"
          onClick={onCopyInvite}
          className="btn-icon h-9 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs"
          title="Copy the invite link"
          aria-label={copiedLink ? 'Invite link copied' : `Copy invite link for room ${room.code}`}
        >
          {copiedLink ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden font-mono tracking-wider lg:inline">{copiedLink ? 'Link copied' : room.code}</span>
        </button>

        {/* Settings / room details */}
        <div className="relative shrink-0" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-controls="room-settings-panel"
            className="btn-icon h-9 w-9 rounded-lg"
            aria-label="Room settings"
            title="Room settings"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </button>
          {settingsOpen && (
            <div
              id="room-settings-panel"
              className="panel absolute right-0 top-11 z-50 w-72 border-bronze p-3 animate-fade-in"
            >
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">Room details</p>
              <dl className="mt-2 space-y-1.5 px-1 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-ash">Code</dt>
                  <dd className="font-mono tracking-wider text-ivory">{room.code}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ash">Label</dt>
                  <dd className="flex items-center gap-1 text-ivory">
                    {room.isPrivate ? <Lock className="h-3 w-3" aria-hidden="true" /> : <Globe className="h-3 w-3" aria-hidden="true" />}
                    {room.isPrivate ? 'Private Room' : 'Public Screening'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ash">Connection</dt>
                  <dd className={`flex items-center gap-1 ${connection.tone}`}>
                    <connection.icon className="h-3 w-3" aria-hidden="true" />
                    {connection.label}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ash">Your role</dt>
                  <dd className="text-ivory">{currentUser.isHost ? 'Host (controls playback)' : 'Viewer (synced to host)'}</dd>
                </div>
              </dl>
              <div className="mt-3 grid gap-1 border-t border-bronze-soft pt-2">
                <PopoverButton icon={codeCopied ? Check : Copy} label={codeCopied ? 'Code copied' : 'Copy room code'} onClick={() => void copyCode()} />
                <PopoverButton icon={Link2} label="Copy invite link" onClick={onCopyInvite} />
                {onEditName && (
                  <PopoverButton icon={Pencil} label="Change display name" onClick={() => {
                    setSettingsOpen(false);
                    onEditName();
                  }} />
                )}
                {onToggleHostRole && (
                  <PopoverButton
                    icon={Users}
                    label={`Switch to ${currentUser.isHost ? 'viewer' : 'host'} (demo)`}
                    onClick={onToggleHostRole}
                  />
                )}
                <PopoverButton icon={ArrowLeft} label="Browse the library" onClick={onOpenDiscover} />
              </div>
            </div>
          )}
        </div>

        {/* You */}
        <div className="hidden shrink-0 items-center gap-1 border-l border-bronze-soft pl-3 md:flex">
          <Avatar name={currentUser.name} src={currentUser.avatar} color={currentUser.color} size={32} isHost={currentUser.isHost} />
          <span className="max-w-[8rem] truncate text-xs font-medium text-ivory" title={currentUser.name}>
            {currentUser.name}
          </span>
          {onEditName && (
            <button
              type="button"
              onClick={onEditName}
              className="rounded-md p-1.5 text-ash transition-colors hover:bg-white/[0.06] hover:text-gold"
              title="Change your name"
              aria-label="Change your name"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onLeave}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-danger/60 bg-danger/15 px-2.5 text-xs font-semibold text-[#f0b7b0] transition-colors hover:bg-danger/30 hover:text-white sm:px-3.5"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Leave Room</span>
        </button>
      </div>
    </nav>
  );
}

function PopoverButton({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs text-ivory/90 transition-colors hover:bg-surface-3 hover:text-gold"
    >
      <Icon className="h-3.5 w-3.5 text-ash" aria-hidden="true" />
      {label}
    </button>
  );
}
