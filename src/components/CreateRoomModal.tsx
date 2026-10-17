import { useState } from 'react';
import { Lock, Globe, Film, Loader2, Rocket, Type, User as UserIcon, ChevronDown } from 'lucide-react';
import type { Movie } from '../types';
import { DISPLAY_NAME_MAX, validateDisplayName } from '../lib/displayName';
import { ModalShell } from './ui/ModalShell';
import { Logo } from './ui/Logo';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  movies: Movie[];
  selectedMovieId?: string;
  /** The user's saved display name (empty if they have not chosen one) */
  defaultHostName?: string;
  /** Resolves to an error message, or null when the room was created */
  onCreateRoom: (data: { roomName: string; movieId: string; isPrivate: boolean; hostName: string }) => Promise<string | null>;
}

export function CreateRoomModal({
  isOpen,
  onClose,
  movies,
  selectedMovieId,
  defaultHostName = '',
  onCreateRoom,
}: CreateRoomModalProps) {
  const [roomName, setRoomName] = useState('Campus Film Club Screening');
  const [movieId, setMovieId] = useState(selectedMovieId || movies[0]?.id || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [hostName, setHostName] = useState(defaultHostName);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;
  const movie = movies.find((m) => m.id === movieId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      setError('Please provide a name for your room.');
      return;
    }
    const nameCheck = validateDisplayName(hostName);
    if (!nameCheck.ok) {
      setError(nameCheck.error);
      return;
    }

    setError('');
    setIsLoading(true);

    const createError = await onCreateRoom({
      roomName: roomName.trim(),
      movieId,
      isPrivate,
      hostName: nameCheck.name,
    });
    setIsLoading(false);

    // Keep the dialog open so the user can see what went wrong
    if (createError) {
      setError(createError);
      return;
    }
    onClose();
  };

  const privacyOption = (value: boolean, Icon: typeof Globe, title: string, caption: string) => {
    const selected = isPrivate === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setIsPrivate(value)}
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
          selected
            ? 'border-gold bg-gold/[0.07] shadow-[inset_0_0_0_1px_rgb(242_210_123/0.25)]'
            : 'border-bronze bg-ink/50 hover:border-gold-muted/60'
        }`}
      >
        <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-gold' : 'text-ash'}`} aria-hidden="true" />
        <span>
          <span className={`block text-sm font-semibold ${selected ? 'text-ivory' : 'text-ivory/80'}`}>{title}</span>
          <span className="block text-[11px] text-ash">{caption}</span>
        </span>
      </button>
    );
  };

  return (
    <ModalShell
      labelledBy="modal-title"
      describedBy="modal-subtitle"
      onClose={onClose}
      busy={isLoading}
      backdropUrl={movie?.backdropUrl}
      widthClass="max-w-xl"
      closeLabel="Close modal"
    >
      <div className="p-6 sm:p-9">
        <Logo />
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Theater Setup</p>
        <h2 id="modal-title" className="heading-display mt-1.5 text-[2rem] text-ivory sm:text-[2.6rem]">
          Create Watch Party Room
        </h2>
        <p id="modal-subtitle" className="mt-2 text-sm text-ivory/80">
          Host a synchronized screening with live chat, reactions & playlist.
        </p>

        {error && (
          <div className="alert-error mt-5" role="alert">
            {error}
          </div>
        )}

        {/* noValidate: our own messages explain what is missing */}
        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="create-room-title" className="field-label">
              <Type className="h-3.5 w-3.5" aria-hidden="true" />
              Room Title
            </label>
            <input
              id="create-room-title"
              type="text"
              value={roomName}
              maxLength={80}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Friday Night Sci-Fi"
              className="field"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="create-room-host" className="field-label">
              <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Host Display Name
            </label>
            <input
              id="create-room-host"
              type="text"
              value={hostName}
              maxLength={DISPLAY_NAME_MAX * 2 /* real limit checked on submit */}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="e.g. Sam"
              autoComplete="nickname"
              className="field"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="create-room-film" className="field-label">
              <Film className="h-3.5 w-3.5" aria-hidden="true" />
              Initial Feature Film
            </label>
            <div className="relative">
              <Film className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" aria-hidden="true" />
              <select
                id="create-room-film"
                value={movieId}
                onChange={(e) => setMovieId(e.target.value)}
                className="field appearance-none pl-11 pr-10"
              >
                {movies.map((m) => (
                  <option key={m.id} value={m.id} className="bg-surface text-ivory">
                    {m.title} ({m.year}) • {m.duration}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" aria-hidden="true" />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="field-label mb-2">Room Privacy</legend>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2" role="radiogroup" aria-label="Room privacy">
              {privacyOption(false, Globe, 'Public', 'Shown as an open screening')}
              {privacyOption(true, Lock, 'Private', 'Shown as a private room')}
            </div>
            <p className="text-[11px] leading-relaxed text-ash">
              Either way, people join with your invite link or room code; this label does not add a password.
            </p>
          </fieldset>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-ash transition-colors hover:text-ivory disabled:opacity-50"
            >
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="btn-gold h-11 px-6 text-sm" aria-busy={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Rocket className="h-4 w-4" aria-hidden="true" />}
              {isLoading ? 'Creating Room…' : 'Launch Party Room'}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
