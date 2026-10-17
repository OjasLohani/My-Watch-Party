import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import type { Toast } from '../types';

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const ICONS = {
  success: { icon: CheckCircle2, tone: 'text-success' },
  error: { icon: AlertCircle, tone: 'text-danger-bright' },
  warning: { icon: AlertTriangle, tone: 'text-gold' },
  info: { icon: Info, tone: 'text-gold-muted' },
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  // Always rendered: screen readers only announce changes to a live
  // region that already exists on the page.
  return (
    <div
      className="pointer-events-none fixed bottom-20 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 md:bottom-5 md:right-5"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const { icon: Icon, tone } = ICONS[toast.type ?? 'info'];
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-bronze bg-surface/95 p-3.5 shadow-[0_20px_40px_-16px_rgb(0_0_0/0.9)] backdrop-blur-md animate-fade-up"
          >
            <Icon className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${tone}`} aria-hidden="true" />
            <p className="flex-1 text-[13px] font-medium leading-snug text-ivory">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-ash transition-colors hover:text-ivory"
              aria-label="Close notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
