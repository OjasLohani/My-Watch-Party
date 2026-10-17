import { useState } from 'react';
import { KeyRound, Loader2, ArrowRight } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';
import { ROOM_CODE_PATTERN } from '../services/roomService';
import { ModalShell } from './ui/ModalShell';
import { Logo } from './ui/Logo';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves to an error message, or null when the room was joined */
  onJoinRoom: (code: string) => Promise<string | null>;
  /** The saved display name, if any (shown so returning guests know it is kept) */
  savedName?: string;
  /** Opens the "change your name" dialog */
  onEditName?: () => void;
}

export function JoinRoomModal({ isOpen, onClose, onJoinRoom, savedName, onEditName }: JoinRoomModalProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setError('Please enter a room code.');
      return;
    }
    if (isSupabaseConfigured() && !ROOM_CODE_PATTERN.test(cleanCode)) {
      setError('Room codes look like FILM-7K3QX9 (a word, a dash, then 6 letters/numbers).');
      return;
    }
    if (cleanCode.length < 4) {
      setError('Room code must be at least 4 characters.');
      return;
    }

    setError('');
    setIsLoading(true);

    const joinError = await onJoinRoom(cleanCode);
    setIsLoading(false);

    // Keep the dialog open so the user can see what went wrong
    if (joinError) {
      setError(joinError);
      return;
    }
    setCode('');
    onClose();
  };

  return (
    <ModalShell labelledBy="join-modal-title" describedBy="join-modal-subtitle" onClose={onClose} busy={isLoading} widthClass="max-w-md" closeLabel="Close modal">
      <div className="p-6 sm:p-8">
        <Logo />
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Screening Pass</p>
        <h2 id="join-modal-title" className="heading-display mt-1.5 text-[2rem] text-ivory sm:text-[2.3rem]">
          Join Watch Party
        </h2>
        <p id="join-modal-subtitle" className="mt-2 text-sm text-ivory/80">
          Enter the room code from your invite to watch in sync with everyone.
        </p>

        {error && (
          <div className="alert-error mt-5" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="join-room-code" className="field-label">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Room Code
            </label>
            <input
              id="join-room-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. FILM-7K3QX9"
              autoComplete="off"
              spellCheck={false}
              className="field font-mono uppercase tracking-[0.12em]"
              autoFocus
            />
          </div>

          {/* Returning guests keep their name; it can be changed here */}
          {savedName && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ash">
              <span>
                Joining as <span className="font-semibold text-ivory">{savedName}</span>
              </span>
              {onEditName && (
                <button type="button" onClick={onEditName} className="text-gold underline-offset-2 hover:underline">
                  Change name
                </button>
              )}
            </p>
          )}

          {/* Quick test codes for demo (only meaningful without Supabase) */}
          {!isSupabaseConfigured() && (
            <div>
              <span className="text-[11px] text-ash">Demo rooms (local sample data):</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {['FILM-CLUB-404', 'CYBER-NIGHT-01', 'ANIME-CLUB-77'].map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => {
                      setCode(quick);
                      setError('');
                    }}
                    className="rounded-md border border-bronze bg-ink/50 px-2.5 py-1 font-mono text-xs text-ivory/85 transition-colors hover:border-gold-muted hover:text-gold"
                  >
                    {quick}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-ash transition-colors hover:text-ivory disabled:opacity-50"
            >
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="btn-gold h-11 px-6 text-sm" aria-busy={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {isLoading ? 'Connecting…' : 'Join Theater'}
              {!isLoading && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
