import { useEffect, useRef, useState } from 'react';
import { MonitorPlay, Loader2, ListPlus, Play } from 'lucide-react';
import { ModalShell } from '../ui/ModalShell';
import { fetchYouTubeInfo, parseYouTubeLink, youTubeThumbnail } from '../../lib/youtube';

interface AddYouTubeDialogProps {
  onClose: () => void;
  /** Resolves to an error message, or null on success */
  onAdd: (video: { videoId: string; title: string }, action: 'queue' | 'play') => Promise<string | null>;
}

type Preview = { videoId: string; title: string; checked: boolean };

/** Host: paste a YouTube link, check it, then queue it or play it now */
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

  return (
    <ModalShell labelledBy="youtube-dialog-title" describedBy="youtube-dialog-description" onClose={onClose} busy={Boolean(busyAction)} widthClass="max-w-md">
      <div className="p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Host</p>
        <h2 id="youtube-dialog-title" className="heading-display mt-1.5 text-[1.9rem] text-ivory">
          Add YouTube Video
        </h2>
        <p id="youtube-dialog-description" className="mt-2 text-sm text-ivory/80">
          Paste a link from youtube.com, youtu.be or YouTube Shorts. Everyone in the room watches it together.
        </p>

        {error && (
          <div className="alert-error mt-5" role="alert">
            {error}
          </div>
        )}

        {/* noValidate: links without https:// are fine; errors come from parseYouTubeLink */}
        <form onSubmit={check} noValidate className="mt-6 space-y-3">
          <label htmlFor="youtube-link-input" className="field-label">
            YouTube link
          </label>
          <div className="relative">
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
              className="field pl-11"
              autoFocus
            />
            <MonitorPlay className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" aria-hidden="true" />
          </div>
          {!preview && (
            <button type="submit" disabled={isChecking} className="btn-ghost h-10 w-full border-bronze text-sm" aria-busy={isChecking}>
              {isChecking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isChecking ? 'Checking video…' : 'Check Link'}
            </button>
          )}
        </form>

        {preview && (
          <div className="mt-4 space-y-3 animate-fade-up" data-testid="youtube-preview">
            <div className="flex items-center gap-3 rounded-xl border border-bronze bg-ink/50 p-2.5">
              <img
                src={youTubeThumbnail(preview.videoId)}
                alt=""
                className="aspect-video w-24 shrink-0 rounded-md bg-surface-2 object-cover"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ivory" title={preview.title}>{preview.title}</p>
                <p className="text-[11px] text-ash">
                  {preview.checked ? 'Ready to play' : 'Could not check this video right now; it may not play.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void add('queue')}
                disabled={Boolean(busyAction)}
                className="btn-ghost h-10 flex-1 border-bronze text-sm"
              >
                {busyAction === 'queue' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ListPlus className="h-4 w-4" aria-hidden="true" />}
                Add to Queue
              </button>
              <button
                type="button"
                onClick={() => void add('play')}
                disabled={Boolean(busyAction)}
                className="btn-gold h-10 flex-1 text-sm"
              >
                {busyAction === 'play' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4 fill-current" aria-hidden="true" />}
                Play Now
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
