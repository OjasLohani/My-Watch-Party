import { useEffect } from 'react';
import { LogOut, Loader2 } from 'lucide-react';

interface LeaveRoomDialogProps {
  isHost: boolean;
  /** A leave request is in progress */
  isLeaving: boolean;
  /** Why the last attempt failed (the user is still in the room) */
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** "Are you sure you want to leave this room?" */
export function LeaveRoomDialog({ isHost, isLeaving, error, onCancel, onConfirm }: LeaveRoomDialogProps) {
  // Escape cancels (not while the request is running)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLeaving) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLeaving, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in">
      <div
        className="relative w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0A0C13] p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-dialog-title"
        aria-describedby="leave-dialog-description"
      >
        <h2 id="leave-dialog-title" className="text-base font-bold text-white">
          Are you sure you want to leave this room?
        </h2>
        <p id="leave-dialog-description" className="mt-1.5 text-xs text-slate-400">
          {isHost
            ? 'You are the host. Hosting will pass to another person in the room right away.'
            : 'You can come back any time with the same invite link.'}
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200" role="alert">
            Could not leave the room: {error} You are still in the room.
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLeaving}
            className="rounded-xl px-4 py-2 text-xs font-medium text-slate-300 hover:text-white transition-colors disabled:opacity-40"
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLeaving}
            aria-busy={isLeaving}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-60"
          >
            {isLeaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            {isLeaving ? 'Leaving…' : 'Leave Room'}
          </button>
        </div>
      </div>
    </div>
  );
}
