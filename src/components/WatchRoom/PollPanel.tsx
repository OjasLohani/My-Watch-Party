import { useState } from 'react';
import { Vote, CheckCircle2, Trophy, Plus, X, Loader2 } from 'lucide-react';
import type { Poll } from '../../types';

interface PollPanelProps {
  /** The room's active poll, or null when there is none */
  poll: Poll | null;
  isHost: boolean;
  /** Each action resolves to an error message, or null on success */
  onVoteCast: (optionId: string) => Promise<string | null>;
  onCreatePoll: (question: string, options: string[]) => Promise<string | null>;
  onClosePoll: () => Promise<string | null>;
}

const MAX_OPTIONS = 6;

export function PollPanel({ poll, isHost, onVoteCast, onCreatePoll, onClosePoll }: PollPanelProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  // Host "new poll" form
  const [isCreating, setIsCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);

  const run = async (action: () => Promise<string | null>) => {
    setError('');
    setIsBusy(true);
    const result = await action();
    setIsBusy(false);
    if (result) setError(result);
    return result;
  };

  const handleVote = async (optionId: string) => {
    if (!poll || poll.userVotedOptionId) return;
    await run(() => onVoteCast(optionId));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) {
      setError('Please enter a question.');
      return;
    }
    if (cleanOptions.length < 2) {
      setError('Please enter at least 2 options.');
      return;
    }
    const failed = await run(() => onCreatePoll(question.trim(), cleanOptions));
    if (!failed) {
      setIsCreating(false);
      setQuestion('');
      setOptions(['', '']);
    }
  };

  const errorBox = error && (
    <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{error}</p>
  );

  const header = (
    <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
      <div>
        <h3 className="text-xs font-bold text-white flex items-center gap-1.5 tracking-wide">
          <Vote className="h-3.5 w-3.5 text-violet-400" />
          Club Selection Poll
        </h3>
        <p className="text-[10px] text-slate-400 font-mono">
          {poll ? `${poll.totalVotes} total verified votes` : 'No active poll'}
        </p>
      </div>

      {isHost && !isCreating && (
        <div className="flex items-center gap-2">
          {poll && (
            <button
              type="button"
              onClick={() => void run(onClosePoll)}
              disabled={isBusy}
              className="text-[10px] text-slate-400 hover:text-white transition-colors disabled:opacity-40"
            >
              Close poll
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setError('');
              setIsCreating(true);
            }}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            <Plus className="h-3 w-3" />
            New Poll
          </button>
        </div>
      )}
    </div>
  );

  // --- Host: create a poll ---
  if (isCreating) {
    return (
      <div className="flex h-full flex-col bg-[#0A0C13] p-4">
        {header}
        <form onSubmit={handleCreate} className="mt-3 flex flex-1 flex-col gap-2.5 overflow-y-auto">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={200}
            placeholder="Ask the room a question…"
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-violet-500/60 focus:outline-none"
            autoFocus
          />
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                maxLength={80}
                placeholder={`Option ${i + 1}`}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-violet-500/60 focus:outline-none"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08]"
                  aria-label={`Remove option ${i + 1}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ''])}
              className="self-start text-[11px] font-semibold text-violet-300 hover:text-white transition-colors"
            >
              + Add option
            </button>
          )}
          {errorBox}
          <div className="mt-auto flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="rounded-xl px-3 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-bold text-white transition-all disabled:opacity-40"
            >
              {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
              Start Poll
            </button>
          </div>
        </form>
      </div>
    );
  }

  // --- No active poll ---
  if (!poll) {
    return (
      <div className="flex h-full flex-col bg-[#0A0C13] p-4">
        {header}
        <p className="mt-6 text-center text-[11px] text-slate-400">
          {isHost ? 'Start a poll to let the room vote.' : 'No poll right now. The host can start one.'}
        </p>
        {errorBox}
      </div>
    );
  }

  const maxVotes = Math.max(...poll.options.map((o) => o.votes), 1);

  return (
    <div className="flex h-full flex-col bg-[#0A0C13] p-4">
      {header}

      {/* Question */}
      <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <p className="text-xs font-semibold text-slate-200 leading-snug">
          {poll.question}
        </p>
      </div>

      {/* Options List */}
      <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto max-h-[360px]" role="radiogroup" aria-label={poll.question}>
        {poll.options.map((opt) => {
          const isVotedByMe = poll.userVotedOptionId === opt.id;
          const isLeader = opt.votes === maxVotes && opt.votes > 0;
          const percentage = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;

          return (
            <div
              key={opt.id}
              onClick={() => !poll.userVotedOptionId && setSelectedOptionId(opt.id)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !poll.userVotedOptionId) {
                  e.preventDefault();
                  setSelectedOptionId(opt.id);
                }
              }}
              role="radio"
              aria-checked={isVotedByMe || selectedOptionId === opt.id}
              aria-disabled={Boolean(poll.userVotedOptionId)}
              aria-label={`${opt.title}: ${opt.votes} votes, ${percentage}%`}
              tabIndex={poll.userVotedOptionId ? -1 : 0}
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

      {errorBox}

      {/* Submit Vote Button if not voted yet */}
      {!poll.userVotedOptionId && (
        <div className="mt-4 pt-3 border-t border-white/[0.06]">
          <button
            type="button"
            disabled={!selectedOptionId || isBusy}
            onClick={() => selectedOptionId && void handleVote(selectedOptionId)}
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
