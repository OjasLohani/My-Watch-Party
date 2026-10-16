import { useState } from 'react';
import { X, Lock, Globe, Film, Loader2 } from 'lucide-react';
import type { Movie } from '../types';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  movies: Movie[];
  selectedMovieId?: string;
  /** Resolves to an error message, or null when the room was created */
  onCreateRoom: (data: { roomName: string; movieId: string; isPrivate: boolean; hostName: string }) => Promise<string | null>;
}

export function CreateRoomModal({
  isOpen,
  onClose,
  movies,
  selectedMovieId,
  onCreateRoom,
}: CreateRoomModalProps) {
  const [roomName, setRoomName] = useState('Campus Film Club Screening');
  const [movieId, setMovieId] = useState(selectedMovieId || movies[0]?.id || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [hostName, setHostName] = useState('Alex Rivera');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      setError('Please provide a name for your room.');
      return;
    }
    if (!hostName.trim()) {
      setError('Please enter your host display name.');
      return;
    }

    setError('');
    setIsLoading(true);

    const createError = await onCreateRoom({
      roomName: roomName.trim(),
      movieId,
      isPrivate,
      hostName: hostName.trim(),
    });
    setIsLoading(false);

    // Keep the dialog open so the user can see what went wrong
    if (createError) {
      setError(createError);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in">
      <div 
        className="relative w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#0A0C13] p-6 shadow-2xl sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div>
          <span className="text-[10px] font-semibold tracking-wider text-violet-400 uppercase">
            Theater Setup
          </span>
          <h2 id="modal-title" className="text-xl font-bold tracking-tight text-white mt-0.5">
            Create Watch Party Room
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Host a synchronized screening with live chat, reactions & playlist.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Creation Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Room Title
            </label>
            <input
              type="text"
              value={roomName}
              maxLength={80}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Friday Night Sci-Fi"
              className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-violet-500/60 focus:bg-white/[0.05] focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Host Display Name
            </label>
            <input
              type="text"
              value={hostName}
              maxLength={40}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-violet-500/60 focus:bg-white/[0.05] focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Initial Feature Film
            </label>
            <div className="relative mt-1.5">
              <select
                value={movieId}
                onChange={(e) => setMovieId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-white/[0.08] bg-[#11131E] px-4 py-2.5 text-sm text-white transition-colors focus:border-violet-500/60 focus:outline-none"
              >
                {movies.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#101220] text-white">
                    {m.title} ({m.year}) • {m.duration}
                  </option>
                ))}
              </select>
              <Film className="pointer-events-none absolute right-4 top-3 h-4 w-4 text-slate-400" />
            </div>
          </div>

          {/* Privacy Option */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Room Privacy
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsPrivate(false)}
                className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                  !isPrivate
                    ? 'border-violet-500/50 bg-violet-950/20 text-white'
                    : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-white/20'
                }`}
              >
                <Globe className={`h-4 w-4 ${!isPrivate ? 'text-violet-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-xs font-semibold">Public</div>
                  <div className="text-[10px] text-slate-400">Campus open join</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setIsPrivate(true)}
                className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                  isPrivate
                    ? 'border-violet-500/50 bg-violet-950/20 text-white'
                    : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-white/20'
                }`}
              >
                <Lock className={`h-4 w-4 ${isPrivate ? 'text-violet-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-xs font-semibold">Private</div>
                  <div className="text-[10px] text-slate-400">Invite code only</div>
                </div>
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-950/50 transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating Room...
                </>
              ) : (
                'Launch Party Room'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
