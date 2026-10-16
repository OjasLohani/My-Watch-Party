import { useState } from 'react';
import { 
  Sparkles, 
  Activity, 
  Users, 
  Sliders, 
  ShieldCheck, 
  Info, 
  Share2, 
  CheckCircle2 
} from 'lucide-react';
import type { Room, User } from '../types';

interface StageOverviewProps {
  room: Room;
  currentUser: User;
  members: User[];
  driftMs: number;
  onSimulateDrift: () => void;
  onToggleHostRole: () => void;
}

export function StageOverview({
  room,
  currentUser,
  members,
  driftMs,
  onSimulateDrift,
  onToggleHostRole,
}: StageOverviewProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>({
    task1: true,
    task2: true,
    task3: false,
    task4: false,
  });

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const toggleTask = (id: string) => {
    setCheckedTasks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Sample Data Disclaimer Banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-950/40 via-[#101222] to-cyan-950/30 p-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Stage 1: Cinematic Foundation Shell</span>
              <span className="rounded bg-violet-400/10 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-violet-300 uppercase">
                Sample Data Active
              </span>
            </div>
            <p className="text-xs text-slate-300">
              You are currently viewing local mock data. In later stages, this connects to your live Supabase database.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyInvite}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:bg-violet-900/20"
          >
            <Share2 className="h-3.5 w-3.5 text-cyan-400" />
            {copiedLink ? 'Link Copied!' : 'Copy Share Link'}
          </button>
        </div>
      </div>

      {/* Main Grid: Room Hero & Quality Target Monitor */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Columns: Room Details & Cinema Club Intro */}
        <div className="space-y-6 lg:col-span-2">
          {/* Cinema Room Card */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f1c] p-6 shadow-2xl">
            {/* Ambient background glow */}
            <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-violet-600/15 blur-3xl"></div>
            <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-cyan-600/10 blur-3xl"></div>

            <div className="relative">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-violet-400 uppercase">
                <Sparkles className="h-4 w-4" />
                Featured College Screening
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
                {room.name}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {room.description}
              </p>

              {/* Room Stats Badges */}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
                <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-200">
                  <Users className="h-4 w-4 text-cyan-400" />
                  <span>{members.length} Members in Room</span>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-200">
                  <ShieldCheck className="h-4 w-4 text-violet-400" />
                  <span>Host: {currentUser.isHost ? 'You (Alex)' : 'Jordan Lee'}</span>
                </div>

                <button
                  type="button"
                  onClick={onToggleHostRole}
                  className="ml-auto rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
                >
                  Switch Role ({currentUser.isHost ? 'Make Spectator' : 'Make Host'})
                </button>
              </div>
            </div>
          </div>

          {/* Members in Room Row */}
          <div className="rounded-2xl border border-white/10 bg-[#0d0f1c] p-5">
            <h2 className="text-sm font-semibold text-white flex items-center justify-between">
              <span>Club Room Members (Sample Data)</span>
              <span className="text-xs font-normal text-slate-400">Target: Up to 10+ concurrent</span>
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 transition-colors hover:border-violet-500/30"
                >
                  <div className="relative">
                    <img
                      src={member.avatar}
                      alt={member.name}
                      className="h-10 w-10 rounded-full object-cover border-2"
                      style={{ borderColor: member.color }}
                    />
                    {member.isHost && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 p-0.5 text-[9px] font-bold text-black" title="Host">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-200">
                      {member.name} {member.isSelf && '(You)'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {member.isHost ? 'Host' : 'Viewer'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Real-time Quality Requirements & Test Bench */}
        <div className="space-y-6">
          {/* Quality Metrics Spec Card */}
          <div className="rounded-2xl border border-white/10 bg-[#0d0f1c] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                Sync Quality Targets
              </h2>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                P95 Benchmark
              </span>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Club selection requires validating latency & drift constraints before claiming sync:
            </p>

            <div className="mt-4 space-y-3">
              {/* Propagation Target */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Target Propagation:</span>
                  <span className="font-mono font-semibold text-cyan-300">≤ 250 ms (p95)</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: '35%' }}></div>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">Local network play/pause command propagation</div>
              </div>

              {/* Drift Correction Target */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Drift Tolerance:</span>
                  <span className="font-mono font-semibold text-violet-300">≤ 500 ms threshold</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-pink-500" style={{ width: `${Math.min(100, (driftMs / 500) * 100)}%` }}></div>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Current simulated drift:</span>
                  <span className="font-mono font-bold text-white">{driftMs} ms</span>
                </div>
              </div>
            </div>

            {/* Test Button for beginner */}
            <div className="mt-4 pt-3 border-t border-white/5">
              <button
                type="button"
                onClick={onSimulateDrift}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-900/30"
              >
                <Sliders className="h-3.5 w-3.5" />
                Simulate Network Jitter Test
              </button>
            </div>
          </div>

          {/* Beginner Checklist for Milestone 1 */}
          <div className="rounded-2xl border border-white/10 bg-[#0d0f1c] p-6 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-violet-400" />
              Milestone 1 Verification Checklist
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Verify these items on your screen before we begin Milestone 2:
            </p>

            <div className="mt-4 space-y-2.5">
              {[
                { id: 'task1', text: 'Tailwind CSS v4 & Lucide Icons are compiling cleanly' },
                { id: 'task2', text: 'Near-black cinematic theme with electric purple & cyan accents is visible' },
                { id: 'task3', text: 'Click "ROOM: FILM-CLUB-404" in the top bar to verify code copying' },
                { id: 'task4', text: 'Click "Switch Role" to test toggling Host vs Viewer status' },
              ].map((task) => (
                <label
                  key={task.id}
                  onClick={() => toggleTask(task.id)}
                  className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs text-slate-300 cursor-pointer hover:bg-white/[0.05] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checkedTasks[task.id]}
                    onChange={() => {}} // handled by parent onClick
                    className="mt-0.5 rounded border-white/20 bg-slate-900 text-violet-600 focus:ring-violet-500"
                  />
                  <span className={checkedTasks[task.id] ? 'line-through text-slate-400' : ''}>
                    {task.text}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
