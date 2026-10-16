import { useState } from 'react';
import { X, Key, Loader2, ArrowRight } from 'lucide-react';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinRoom: (code: string) => void;
}

export function JoinRoomModal({ isOpen, onClose, onJoinRoom }: JoinRoomModalProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setError('Please enter a room code.');
      return;
    }
    if (cleanCode.length < 4) {
      setError('Room code must be at least 4 characters.');
      return;
    }

    setError('');
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      onJoinRoom(cleanCode);
      onClose();
    }, 400);
  };

  const handleSelectQuickCode = (quickCode: string) => {
    setCode(quickCode);
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in">
      <div 
        className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0A0C13] p-6 shadow-2xl sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-modal-title"
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
            Club Screening Pass
          </span>
          <h2 id="join-modal-title" className="text-xl font-bold tracking-tight text-white mt-0.5">
            Join Watch Party
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Enter an invite code to synchronize into an active theater session.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Room Code
            </label>
            <div className="relative mt-1.5">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. FILM-CLUB-404"
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-2.5 font-mono text-sm uppercase text-white placeholder-slate-500 tracking-wider transition-colors focus:border-violet-500/60 focus:bg-white/[0.05] focus:outline-none"
                autoFocus
              />
              <Key className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            </div>
          </div>

          {/* Quick test codes for demo */}
          <div>
            <span className="text-[11px] text-slate-400 font-mono">Quick Test Rooms (Mock Data):</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {['FILM-CLUB-404', 'CYBER-NIGHT-01', 'ANIME-CLUB-77'].map((quick) => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => handleSelectQuickCode(quick)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 font-mono text-xs text-slate-300 hover:border-violet-500/30 hover:bg-violet-950/20 hover:text-white transition-colors"
                >
                  {quick}
                </button>
              ))}
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
                  Connecting...
                </>
              ) : (
                <>
                  Join Theater
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
