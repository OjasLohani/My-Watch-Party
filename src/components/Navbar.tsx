import { Film, Plus, LogIn, Compass, Tv, Shield } from 'lucide-react';
import type { User, ViewMode, Room } from '../types';

interface NavbarProps {
  currentView: ViewMode;
  onNavigate: (view: ViewMode) => void;
  currentUser: User;
  activeRoom: Room;
  onOpenCreateModal: () => void;
  onOpenJoinModal: () => void;
  onToggleHostRole: () => void;
  /** False in real rooms, where the database decides who is host */
  canToggleHostRole?: boolean;
}

export function Navbar({
  currentView,
  onNavigate,
  currentUser,
  activeRoom,
  onOpenCreateModal,
  onOpenJoinModal,
  onToggleHostRole,
  canToggleHostRole = true,
}: NavbarProps) {
  return (
    <nav className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#06070B]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand & Main Navigation */}
        <div className="flex items-center gap-8">
          <button
            type="button"
            onClick={() => onNavigate('discover')}
            className="flex items-center gap-3 text-left transition-opacity hover:opacity-90 focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-300 shadow-inner">
              <Film className="h-4.5 w-4.5 text-violet-400" />
            </div>
            <div>
              <span className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                WATCH<span className="text-violet-400">PARTY</span>
              </span>
              <div className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">
                Cinema Club
              </div>
            </div>
          </button>

          {/* Navigation Tab Pills */}
          <div className="hidden md:flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => onNavigate('discover')}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide transition-all ${
                currentView === 'discover'
                  ? 'bg-white/[0.1] text-white shadow-sm border border-white/10 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Compass className="h-3.5 w-3.5 text-slate-300" />
              Discover
            </button>

            <button
              type="button"
              onClick={() => onNavigate('room')}
              className={`relative flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide transition-all ${
                currentView === 'room'
                  ? 'bg-violet-600/20 text-violet-200 border border-violet-500/30 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Tv className="h-3.5 w-3.5 text-violet-400" />
              <span>Watch Room</span>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
            </button>
          </div>
        </div>

        {/* Action Controls & User Avatar */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Quick Room Actions */}
          <button
            type="button"
            onClick={onOpenJoinModal}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white"
          >
            <LogIn className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden sm:inline">Join Room</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateModal}
            className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-950/60 transition-all active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create Room</span>
          </button>

          {/* User Status / Role Switcher */}
          <div className="border-l border-white/[0.08] pl-2.5 sm:pl-3">
            <button
              type="button"
              onClick={canToggleHostRole ? onToggleHostRole : undefined}
              disabled={!canToggleHostRole}
              title={`Role: ${currentUser.isHost ? 'Host' : 'Viewer'}${canToggleHostRole ? ' • Click to toggle (demo)' : ''}`}
              className="group flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] p-1 pr-3 transition-colors hover:border-violet-500/40 hover:bg-white/[0.05]"
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="h-7 w-7 rounded-full object-cover ring-1 ring-violet-500/30"
              />
              <div className="text-left hidden lg:block">
                <div className="flex items-center gap-1 text-[11px] font-bold text-slate-200">
                  {currentUser.name}
                  {currentUser.isHost && (
                    <span title="Room Host">
                      <Shield className="h-3 w-3 text-amber-400" />
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {currentUser.isHost ? 'Host' : 'Viewer'}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Subnav */}
      <div className="flex md:hidden border-t border-white/[0.06] bg-[#07080D] px-4 py-1.5 gap-2 justify-around">
        <button
          type="button"
          onClick={() => onNavigate('discover')}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg ${
            currentView === 'discover' ? 'text-white font-bold bg-white/[0.08]' : 'text-slate-400'
          }`}
        >
          <Compass className="h-3.5 w-3.5" />
          Discover
        </button>
        <button
          type="button"
          onClick={() => onNavigate('room')}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg ${
            currentView === 'room' ? 'text-violet-300 font-bold bg-violet-950/40 border border-violet-500/20' : 'text-slate-400'
          }`}
        >
          <Tv className="h-3.5 w-3.5 text-violet-400" />
          Watch Room ({activeRoom.code})
        </button>
      </div>
    </nav>
  );
}
