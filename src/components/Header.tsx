import { useState } from 'react';
import { Film, Copy, Check, Shield } from 'lucide-react';
import type { Room, User } from '../types';

interface HeaderProps {
  room: Room;
  currentUser: User;
  driftMs: number;
  onToggleHostRole: () => void;
}

export function Header({ room, currentUser, driftMs, onToggleHostRole }: HeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted in browser
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#090a12]/85 backdrop-blur-md transition-all">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand & Room Info */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 to-cyan-400 p-0.5 shadow-lg shadow-violet-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#0d0f1b]">
              <Film className="h-5 w-5 text-cyan-300" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white sm:text-lg">
                Watch<span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-cyan-400">Party</span>
              </span>
              <span className="hidden rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-300 md:inline-flex">
                College Film Club
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate max-w-[200px] sm:max-w-xs">
              {room.name}
            </p>
          </div>
        </div>

        {/* Sync Status & Room Code */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live Sync Badge */}
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-300 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="hidden sm:inline">Sync Engine:</span>
            <span className="font-mono text-emerald-200">{driftMs}ms</span>
          </div>

          {/* Room Code Copy Button */}
          <button
            type="button"
            onClick={handleCopyCode}
            title="Click to copy room code"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-mono font-medium text-slate-200 transition-all hover:border-violet-500/40 hover:bg-violet-950/30 hover:text-white"
          >
            <span className="text-slate-400 text-[11px]">ROOM:</span>
            <span>{room.code}</span>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          {/* User Profile & Host Switcher */}
          <div className="flex items-center gap-2 border-l border-white/10 pl-2 sm:pl-3">
            <button
              type="button"
              onClick={onToggleHostRole}
              title="Click to test toggling Host vs Spectator mode"
              className="group flex items-center gap-2 rounded-full border border-white/10 bg-[#121422] p-1 pr-3 transition-colors hover:border-violet-500/40"
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="h-7 w-7 rounded-full object-cover ring-1 ring-violet-500/50"
              />
              <div className="text-left hidden md:block">
                <div className="flex items-center gap-1 text-xs font-semibold text-slate-200">
                  {currentUser.name}
                  {currentUser.isHost && (
                    <span title="Room Host">
                      <Shield className="h-3 w-3 text-amber-400" />
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {currentUser.isHost ? 'Host (Controls Video)' : 'Spectator (Sync Only)'}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
