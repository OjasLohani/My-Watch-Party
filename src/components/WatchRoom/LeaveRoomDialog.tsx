import { LogOut, Loader2 } from 'lucide-react';
import { ModalShell } from '../ui/ModalShell';

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
  return (
    <ModalShell
      role="alertdialog"
      labelledBy="leave-dialog-title"
      describedBy="leave-dialog-description"
      onClose={onCancel}
      busy={isLeaving}
      showClose={false}
      widthClass="max-w-sm"
    >
      <div className="p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-danger/50 bg-danger/15 text-danger-bright">
          <LogOut className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <h2 id="leave-dialog-title" className="mt-4 text-lg font-semibold text-ivory">
          Are you sure you want to leave this room?
        </h2>
        <p id="leave-dialog-description" className="mt-1.5 text-sm text-ash">
          {isHost
            ? 'You are the host. Hosting will pass to another person in the room right away.'
            : 'You can come back any time with the same invite link.'}
        </p>

        {error && (
          <div className="alert-error mt-4" role="alert">
            Could not leave the room: {error} You are still in the room.
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLeaving}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-ivory/85 transition-colors hover:text-ivory disabled:opacity-40"
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLeaving}
            aria-busy={isLeaving}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition-colors hover:bg-danger-bright disabled:opacity-60"
          >
            {isLeaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
            {isLeaving ? 'Leaving…' : 'Leave Room'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
