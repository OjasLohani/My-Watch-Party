import { useEffect, useRef, useState } from 'react';
import { Loader2, ListPlus, Play, Link2 } from 'lucide-react';
import { ModalShell } from '../ui/ModalShell';
import { YouTubeLogo } from '../ui/YouTubeLogo';
import { fetchYouTubeInfo, parseYouTubeLink, youTubeThumbnail } from '../../lib/youtube';

interface AddYouTubeDialogProps {
  onClose: () => void;
  /** Resolves to an error message, or null on success */
  onAdd: (video: { videoId: string; title: string }, action: 'queue' | 'play') => Promise<string | null>;
}

type Preview = { videoId: string; title: string; checked: boolean };

/**
 * Host: paste a YouTube link, check it, then watch it together now (it
 * becomes the room's current video for everyone) or add it to the queue.
 */
export function AddYouTubeDialog({ onClose, onAdd }: AddYouTubeDialogProps) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [busyAction, setBusyAction] = useState<'queue' | 'play' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const checkRef = useRef<AbortController | null>(null);

  // Cancel a running check when the dialog closes
  useEffect(() => () => checkRef.current?.abort(), []);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setPreview(null);
    const parsed = parseYouTubeLink(link);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError('');
    setIsChecking(true);
    checkRef.current?.abort();
    const controller = new AbortController();
    checkRef.current = controller;
    const info = await fetchYouTubeInfo(parsed.videoId, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
    if (controller.signal.aborted) return;
    setIsChecking(false);
    if (!info.ok) {
      setError(info.error);
      return;
    }
    setPreview({ videoId: parsed.videoId, title: info.title, checked: info.checked });
  };

  const add = async (action: 'queue' | 'play') => {
    if (!preview || busyAction) return;
    setBusyAction(action);
    setError('');
    const failed = await onAdd({ videoId: preview.videoId, title: preview.title }, action);
    setBusyAction(null);
    if (failed) setError(failed);
    else onClose();
  };

  const cancelButton = (
    <button
      type="button"
      onClick={onClose}
      disabled={Boolean(busyAction)}
      className="rounded-lg px-4 py-2.5 text-sm font-medium text-ash transition-colors hover:text-ivory disabled:opacity-50"
    >
      Cancel
    </button>
  );

  return (
    <ModalShell labelledBy="youtube-dialog-title" describedBy="youtube-dialog-description" onClose={onClose} busy={Boolean(busyAction)} widthClass="max-w-lg">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-bronze bg-ink/60">
            <YouTubeLogo className="h-5 w-7" />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Host • YouTube</p>
        </div>
        <h2 id="youtube-dialog-title" className="heading-display mt-4 text-[2rem] text-ivory">
          Watch YouTube Together
        </h2>
        <p id="youtube-dialog-description" className="mt-2 text-sm text-ivory/80">
          Paste a link from youtube.com, youtu.be or YouTube Shorts. It plays for everyone in the room, in sync.
        </p>

        {error && (
          <div className="alert-error mt-5" role="alert">
            {error}
          </div>
        )}

        {/* noValidate: links without https:// are fine; errors come from parseYouTubeLink */}
        <form onSubmit={check} noValidate className="mt-6 space-y-3">
          <label htmlFor="youtube-link-input" className="field-label">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            YouTube link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                id="youtube-link-input"
                type="url"
                inputMode="url"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setPreview(null);
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                maxLength={300}
                autoComplete="off"
                className="field pl-12"
                autoFocus
              />
              <YouTubeLogo className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-5 -translate-y-1/2" />
            </div>
            <button
              type="submit"
              disabled={isChecking || Boolean(busyAction)}
              className="btn-ghost h-[46px] shrink-0 border-bronze px-5 text-sm"
              aria-busy={isChecking}
            >
              {isChecking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isChecking ? 'Checking…' : 'Check Link'}
            </button>
          </div>
        </form>

        {preview ? (
          <div className="mt-5 animate-fade-up" data-testid="youtube-preview">
            <div className="overflow-hidden rounded-xl border border-bronze bg-ink/50">
              <img
                src={youTubeThumbnail(preview.videoId)}
                alt=""
                className="aspect-video w-full bg-surface-2 object-cover"
              />
              <div className="flex items-start gap-3 p-3.5">
                <YouTubeLogo className="mt-0.5 h-4 w-6 shrink-0" />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold text-ivory" title={preview.title}>{preview.title}</p>
                  <p className="mt-0.5 text-[11px] text-ash">
                    {preview.checked ? 'Ready to play for everyone' : 'Could not check this video right now; it may not play.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {cancelButton}
              <button
                type="button"
                onClick={() => void add('queue')}
                disabled={Boolean(busyAction)}
                className="btn-ghost h-11 border-bronze px-4 text-sm"
              >
                {busyAction === 'queue' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ListPlus className="h-4 w-4" aria-hidden="true" />}
                Add to Queue
              </button>
              <button
                type="button"
                onClick={() => void add('play')}
                disabled={Boolean(busyAction)}
                className="btn-gold h-11 px-6 text-sm"
                aria-busy={busyAction === 'play'}
              >
                {busyAction === 'play' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4 fill-current" aria-hidden="true" />}
                Watch Together
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex justify-end">{cancelButton}</div>
        )}
      </div>
    </ModalShell>
  );
}
