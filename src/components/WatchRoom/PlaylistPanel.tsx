import { Play, Plus, Clock, Film, ChevronUp, ChevronDown, X } from 'lucide-react';
import type { PlaylistItem } from '../../types';

interface PlaylistPanelProps {
  playlist: PlaylistItem[];
  currentMovieId: string;
  isHost: boolean;
  onSelectMovie: (item: PlaylistItem) => void;
  onOpenDiscover: () => void;
  /** Host only: remove a title from the shared queue */
  onRemoveItem?: (item: PlaylistItem) => void;
  /** Host only: move a title up (-1) or down (1) */
  onMoveItem?: (item: PlaylistItem, direction: -1 | 1) => void;
  /** Current display names by user id */
  nameById?: Map<string, string>;
}

export function PlaylistPanel({
  playlist,
  currentMovieId,
  isHost,
  onSelectMovie,
  onOpenDiscover,
  onRemoveItem,
  onMoveItem,
  nameById,
}: PlaylistPanelProps) {
  return (
    <div className="flex h-full flex-col bg-[#0A0C13] p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div>
          <h3 className="text-xs font-bold text-white flex items-center gap-1.5 tracking-wide">
            <Film className="h-3.5 w-3.5 text-violet-400" />
            Screening Queue
          </h3>
          <p className="text-[10px] text-slate-400 font-mono">
            {playlist.length} titles queued for room
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenDiscover}
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors"
        >
          <Plus className="h-3 w-3" />
          Queue Film
        </button>
      </div>

      {playlist.length === 0 && (
        <p className="mt-6 text-center text-[11px] text-slate-400">
          {isHost
            ? 'The queue is empty. Use “Queue Film” or the + on any movie card.'
            : 'The queue is empty. The host can add films.'}
        </p>
      )}

      {/* Playlist Items */}
      <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1 max-h-[460px]">
        {playlist.map((item, index) => {
          const isCurrent = item.movieId === currentMovieId;

          return (
            <div
              key={item.id}
              className={`group flex items-center gap-3 rounded-xl border p-2.5 transition-all ${
                isCurrent
                  ? 'border-violet-500/40 bg-violet-950/20 shadow-md'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
              }`}
            >
              {/* Index Number */}
              <span className="font-mono text-[11px] font-bold text-slate-400 w-4 text-center">
                {index + 1}
              </span>

              {/* Thumbnail */}
              <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-lg bg-slate-900 border border-white/10">
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80';
                  }}
                />
                {isCurrent && (
                  <div className="absolute inset-0 flex items-center justify-center bg-violet-950/70 backdrop-blur-[1px]">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400"></span>
                    </span>
                  </div>
                )}
              </div>

              {/* Title & Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h4 className="truncate text-xs font-bold text-white group-hover:text-violet-300 transition-colors">
                    {item.title}
                  </h4>
                  {isCurrent && (
                    <span className="rounded bg-violet-500/20 px-1.5 py-0.2 text-[9px] font-bold text-violet-300 font-mono">
                      LIVE
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="flex items-center gap-0.5 font-mono">
                    <Clock className="h-2.5 w-2.5" />
                    {item.duration}
                  </span>
                  <span>•</span>
                  <span className="truncate">Added by {(item.addedById && nameById?.get(item.addedById)) || item.addedBy}</span>
                </div>
              </div>

              {/* Host Controls: reorder / remove */}
              {isHost && (onMoveItem || onRemoveItem) && (
                <div className="flex flex-col">
                  {onMoveItem && (
                    <>
                      <button
                        type="button"
                        onClick={() => onMoveItem(item, -1)}
                        disabled={index === 0}
                        className="rounded p-0.5 text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30"
                        title="Move up"
                        aria-label={`Move ${item.title} up`}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMoveItem(item, 1)}
                        disabled={index === playlist.length - 1}
                        className="rounded p-0.5 text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30"
                        title="Move down"
                        aria-label={`Move ${item.title} down`}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Host Control: Play Now Button */}
              {isHost && !isCurrent && (
                <button
                  type="button"
                  onClick={() => onSelectMovie(item)}
                  className="rounded-lg bg-violet-600 p-2 text-white opacity-80 group-hover:opacity-100 hover:bg-violet-500 transition-all shadow-sm"
                  title="Switch stream to this film (Host action)"
                  aria-label={`Play ${item.title}`}
                >
                  <Play className="h-3 w-3 fill-white" />
                </button>
              )}

              {isHost && onRemoveItem && (
                <button
                  type="button"
                  onClick={() => onRemoveItem(item)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  title="Remove from queue"
                  aria-label={`Remove ${item.title} from queue`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
