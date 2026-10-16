import { useEffect, useState } from 'react';
import { X, User as UserIcon, Loader2 } from 'lucide-react';
import { DISPLAY_NAME_MAX, validateDisplayName } from '../lib/displayName';

interface NameModalProps {
  /** 'join': asked before entering a room; 'edit': changing it later */
  mode: 'join' | 'edit';
  initialName: string;
  onClose: () => void;
  /** Resolves to an error message, or null when the name was saved */
  onSave: (name: string) => Promise<string | null>;
}

/** Asks for (or edits) the display name everyone else sees */
export function NameModal({ mode, initialName, onClose, onSave }: NameModalProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Escape closes the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateDisplayName(name);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
    setIsSaving(true);
    const saveError = await onSave(result.name);
    setIsSaving(false);
    if (saveError) setError(saveError);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in">
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0A0C13] p-6 shadow-2xl sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div>
          <span className="text-[10px] font-semibold tracking-wider text-violet-400 uppercase">
            {mode === 'join' ? 'Before you join' : 'Your profile'}
          </span>
          <h2 id="name-modal-title" className="text-xl font-bold tracking-tight text-white mt-0.5">
            {mode === 'join' ? 'What should we call you?' : 'Change your name'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            This is the name others see in the room and in chat. It is remembered on this device.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="display-name-input" className="block text-xs font-semibold text-slate-300">
              Display name
            </label>
            <div className="relative mt-1.5">
              <input
                id="display-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={DISPLAY_NAME_MAX * 2 /* emoji take 2 units; the real limit is checked on save */}
                placeholder="e.g. Sam"
                autoComplete="nickname"
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-violet-500/60 focus:bg-white/[0.05] focus:outline-none"
                autoFocus
              />
              <UserIcon className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Up to {DISPLAY_NAME_MAX} characters.</p>
          </div>

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
              disabled={isSaving}
              className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-5 py-2 text-xs font-bold text-white transition-all disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === 'join' ? 'Continue' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
