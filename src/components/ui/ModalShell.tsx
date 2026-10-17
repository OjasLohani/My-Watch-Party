import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalShellProps {
  /** id of the heading that names the dialog */
  labelledBy: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  /** Escape / close button / backdrop click. Omit to make the dialog undismissable. */
  onClose?: () => void;
  /** While true (e.g. a request is running) the dialog cannot be dismissed */
  busy?: boolean;
  /** Optional artwork shown faintly behind the panel content */
  backdropUrl?: string;
  /** Tailwind max-width class for the panel */
  widthClass?: string;
  closeLabel?: string;
  /** Show the X button (default true when onClose is set) */
  showClose?: boolean;
  children: ReactNode;
}

/** Open dialogs, newest last: only the top one reacts to Escape and Tab */
const openDialogs: object[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dark, bronze-framed dialog: Escape closes it, Tab stays inside it, and
 * focus returns to where it was when it closes.
 */
export function ModalShell({
  labelledBy,
  describedBy,
  role = 'dialog',
  onClose,
  busy = false,
  backdropUrl,
  widthClass = 'max-w-lg',
  closeLabel = 'Close',
  showClose = true,
  children,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const token = {};
    openDialogs.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the field marked autoFocus (React focuses it first), else the
    // first form field, else the first control, else the panel
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
        ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (openDialogs.at(-1) !== token) return;
      if (e.key === 'Escape') {
        if (!busyRef.current) closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openDialogs.splice(openDialogs.indexOf(token), 1);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm animate-fade-in sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`relative my-auto w-full ${widthClass} overflow-hidden rounded-2xl border border-bronze bg-surface shadow-[0_40px_80px_-30px_rgb(0_0_0/0.95)] animate-fade-up focus:outline-none`}
      >
        {backdropUrl && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <img
              src={backdropUrl}
              alt=""
              className="h-full w-full object-cover object-center opacity-30 [filter:sepia(0.45)_saturate(0.7)_brightness(0.7)]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/90 to-surface/55" />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-surface/40" />
          </div>
        )}
        {onClose && showClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="absolute right-3.5 top-3.5 z-10 rounded-lg p-1.5 text-ash transition-colors hover:bg-white/[0.06] hover:text-ivory disabled:opacity-40"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
