import { useState } from 'react';
import { User as UserIcon, Loader2 } from 'lucide-react';
import { DISPLAY_NAME_MAX, validateDisplayName } from '../lib/displayName';
import { ModalShell } from './ui/ModalShell';

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
    <ModalShell labelledBy="name-modal-title" describedBy="name-modal-description" onClose={onClose} busy={isSaving} widthClass="max-w-md">
      <div className="p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
          {mode === 'join' ? 'Before you join' : 'Your profile'}
        </p>
        <h2 id="name-modal-title" className="heading-display mt-1.5 text-[1.9rem] text-ivory">
          {mode === 'join' ? 'What should we call you?' : 'Change your name'}
        </h2>
        <p id="name-modal-description" className="mt-2 text-sm text-ivory/80">
          This is the name others see in the room and in chat. It is remembered on this device.
        </p>

        {error && (
          <div className="alert-error mt-5" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="display-name-input" className="field-label">
              <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Display name
            </label>
            <input
              id="display-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={DISPLAY_NAME_MAX * 2 /* emoji take 2 units; the real limit is checked on save */}
              placeholder="e.g. Sam"
              autoComplete="nickname"
              aria-describedby="display-name-hint"
              className="field"
              autoFocus
            />
            <p id="display-name-hint" className="text-[11px] text-ash">Up to {DISPLAY_NAME_MAX} characters.</p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-ash transition-colors hover:text-ivory disabled:opacity-50"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="btn-gold h-10 px-6 text-sm" aria-busy={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {mode === 'join' ? 'Continue' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
