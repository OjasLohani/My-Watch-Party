import { useEffect, useRef, useState } from 'react';
import { X, MonitorPlay, Loader2, ListPlus, Play } from 'lucide-react';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyAction) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      checkRef.current?.abort();
    };
  }, [busyAction, onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in">
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0A0C13] p-6 shadow-2xl sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-dialog-title"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(busyAction)}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <span className="text-[10px] font-semibold tracking-wider text-violet-400 uppercase">Host</span>
        <h2 id="youtube-dialog-title" className="text-xl font-bold tracking-tight text-white mt-0.5">
          Add YouTube Video
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Paste a link from youtube.com, youtu.be or YouTube Shorts. Everyone in the room watches it together.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200" role="alert">
            {error}
          </div>
        )}

        {/* noValidate: links without https:// are fine; errors come from parseYouTubeLink */}
        <form onSubmit={check} noValidate className="mt-5 space-y-3">
          <label htmlFor="youtube-link-input" className="block text-xs font-semibold text-slate-300">
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
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-violet-500/60 focus:outline-none"
              autoFocus
            />
            <MonitorPlay className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
          </div>
          {!preview && (
            <button
              type="submit"
              disabled={isChecking}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-600/20 px-4 py-2.5 text-xs font-semibold text-violet-200 hover:bg-violet-600/30 transition-colors disabled:opacity-50"
            >
              {isChecking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isChecking ? 'Checking video…' : 'Check Link'}
            </button>
          )}
        </form>

        {preview && (
          <div className="mt-4 space-y-3" data-testid="youtube-preview">
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
              <img
                src={youTubeThumbnail(preview.videoId)}
                alt=""
                className="aspect-video w-24 shrink-0 rounded-lg object-cover bg-slate-900"
              />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-white" title={preview.title}>{preview.title}</p>
                <p className="text-[10px] text-slate-400">
                  {preview.checked ? 'Ready to play' : 'Could not check this video right now; it may not play.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void add('queue')}
                disabled={Boolean(busyAction)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08] transition-colors disabled:opacity-50"
              >
                {busyAction === 'queue' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
                Add to Queue
              </button>
              <button
                type="button"
                onClick={() => void add('play')}
                disabled={Boolean(busyAction)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-3 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
              >
                {busyAction === 'play' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                Play Now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
