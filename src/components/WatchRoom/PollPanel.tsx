import { useState } from 'react';
import { Vote, CheckCircle2, Trophy, RotateCcw } from 'lucide-react';
import type { Poll } from '../../types';

interface PollPanelProps {
  initialPoll: Poll;
  onVoteCast: (optionId: string) => void;
}

export function PollPanel({ initialPoll, onVoteCast }: PollPanelProps) {
  const [poll, setPoll] = useState<Poll>(initialPoll);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);

  const handleVote = (optionId: string) => {
    if (poll.userVotedOptionId) return;

    setPoll((prev) => {
      const updatedOptions = prev.options.map((opt) =>
        opt.id === optionId ? { ...opt, votes: opt.votes + 1 } : opt
      );
      return {
        ...prev,
        options: updatedOptions,
        totalVotes: prev.totalVotes + 1,
        userVotedOptionId: optionId,
      };
    });

    onVoteCast(optionId);
  };

  const handleResetVote = () => {
    if (!poll.userVotedOptionId) return;
    const votedId = poll.userVotedOptionId;
    setPoll((prev) => {
      const updatedOptions = prev.options.map((opt) =>
        opt.id === votedId ? { ...opt, votes: Math.max(0, opt.votes - 1) } : opt
      );
      return {
        ...prev,
        options: updatedOptions,
        totalVotes: Math.max(0, prev.totalVotes - 1),
        userVotedOptionId: undefined,
      };
    });
    setSelectedOptionId(null);
  };

  const maxVotes = Math.max(...poll.options.map((o) => o.votes), 1);

  return (
    <div className="flex h-full flex-col bg-[#0A0C13] p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div>
          <h3 className="text-xs font-bold text-white flex items-center gap-1.5 tracking-wide">
            <Vote className="h-3.5 w-3.5 text-violet-400" />
            Club Selection Poll
          </h3>
          <p className="text-[10px] text-slate-400 font-mono">
            {poll.totalVotes} total verified votes
          </p>
        </div>

        {poll.userVotedOptionId && (
          <button
            type="button"
            onClick={handleResetVote}
            title="Reset vote for testing"
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>

      {/* Question */}
      <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <p className="text-xs font-semibold text-slate-200 leading-snug">
          {poll.question}
        </p>
      </div>

      {/* Options List */}
      <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto max-h-[360px]">
        {poll.options.map((opt) => {
          const isVotedByMe = poll.userVotedOptionId === opt.id;
          const isLeader = opt.votes === maxVotes && opt.votes > 0;
          const percentage = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;

          return (
            <div
              key={opt.id}
              onClick={() => !poll.userVotedOptionId && setSelectedOptionId(opt.id)}
              className={`relative overflow-hidden rounded-xl border p-3 transition-all ${
                isVotedByMe
                  ? 'border-violet-500/60 bg-violet-950/30'
                  : selectedOptionId === opt.id && !poll.userVotedOptionId
                  ? 'border-violet-400/50 bg-white/[0.05] cursor-pointer'
                  : poll.userVotedOptionId
                  ? 'border-white/[0.06] bg-white/[0.02]'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] cursor-pointer'
              }`}
            >
              {/* Progress bar fill */}
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-700 ease-out ${
                  isLeader ? 'bg-violet-600/20' : 'bg-white/[0.03]'
                }`}
                style={{ width: `${percentage}%` }}
              />

              <div className="relative z-10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/20 bg-slate-900">
                    {isVotedByMe ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-400" />
                    ) : selectedOptionId === opt.id ? (
                      <div className="h-2 w-2 rounded-full bg-violet-400" />
                    ) : null}
                  </div>

                  <span className="truncate text-xs font-medium text-white">
                    {opt.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-xs">
                  {isLeader && (
                    <span title="Current Leader">
                      <Trophy className="h-3 w-3 text-amber-400" />
                    </span>
                  )}
                  <span className="font-mono font-bold text-slate-300">{percentage}%</span>
                  <span className="text-[10px] text-slate-400 font-mono">({opt.votes})</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit Vote Button if not voted yet */}
      {!poll.userVotedOptionId && (
        <div className="mt-4 pt-3 border-t border-white/[0.06]">
          <button
            type="button"
            disabled={!selectedOptionId}
            onClick={() => selectedOptionId && handleVote(selectedOptionId)}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 py-2.5 text-xs font-bold text-white shadow-md shadow-violet-950/50 transition-all disabled:opacity-40"
          >
            {selectedOptionId ? 'Confirm and Cast Vote' : 'Select an Option Above'}
          </button>
        </div>
      )}

      {poll.userVotedOptionId && (
        <div className="mt-3 text-center text-[11px] text-emerald-400 flex items-center justify-center gap-1.5 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Your vote has been counted for this screening.</span>
        </div>
      )}
    </div>
  );
}
