import { Play, Plus, ChevronUp, ChevronDown, X, MonitorPlay, ListVideo } from 'lucide-react';
import type { PlaylistItem } from '../../types';
import { Artwork } from '../ui/Artwork';

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
  /** Host only: open the "Add YouTube Video" dialog */
  onAddYouTube?: () => void;
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
  onAddYouTube,
}: PlaylistPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-ivory">Screening Queue</h3>
          <p className="text-[11px] text-ash">
            {playlist.length} {playlist.length === 1 ? 'title' : 'titles'} • {isHost ? 'you control the queue' : 'the host controls the queue'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {isHost && onAddYouTube && (
            <button type="button" onClick={onAddYouTube} className="btn-gold h-8 px-2.5 text-xs">
              <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />
              YouTube
            </button>
          )}
          <button
            type="button"
            onClick={onOpenDiscover}
            className="btn-icon h-8 gap-1 rounded-lg px-2.5 text-xs"
            title="Pick a film from the library"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Queue Film
          </button>
        </div>
      </div>

      {playlist.length === 0 && (
        <div className="mx-4 mt-2 flex flex-col items-center rounded-xl border border-dashed border-bronze px-4 py-8 text-center">
          <ListVideo className="h-6 w-6 text-gold-muted" aria-hidden="true" />
          <p className="mt-2 text-xs text-ash">
            {isHost
              ? 'The queue is empty. Use “Queue Film”, “YouTube” or the queue button on any film.'
              : 'The queue is empty. The host can add films and videos.'}
          </p>
        </div>
      )}

      <ol className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {playlist.map((item, index) => {
          const isCurrent = item.movieId === currentMovieId;
          const isYouTube = item.movieId.startsWith('yt:');
          return (
            <li
              key={item.id}
              className={`group flex items-center gap-3 rounded-xl border p-2 transition-colors ${
                isCurrent ? 'border-gold-muted/60 bg-gold/[0.06]' : 'border-bronze-soft bg-ink/30 hover:border-bronze'
              }`}
            >
              <span className="w-4 text-center text-[11px] font-semibold text-ash-muted">{index + 1}</span>
              <span className="relative aspect-video w-[72px] shrink-0 overflow-hidden rounded-md border border-bronze bg-surface-2">
                <Artwork sources={[item.thumbnailUrl]} alt="" className="h-full w-full object-cover" />
                {isYouTube && (
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-ink/85 px-1 text-[8px] font-bold uppercase tracking-wider text-ivory">YT</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className={`truncate text-[13px] font-medium ${isCurrent ? 'text-gold' : 'text-ivory'}`}>{item.title}</span>
                  {isCurrent && (
                    <span className="shrink-0 rounded bg-gold/15 px-1.5 text-[9px] font-bold uppercase tracking-wider text-gold">Now</span>
                  )}
                </p>
                <p className="truncate text-[11px] text-ash">
                  {item.duration} • Added by {(item.addedById && nameById?.get(item.addedById)) || item.addedBy}
                </p>
              </div>

              {/* Host controls: reorder, play, remove */}
              {isHost && onMoveItem && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => onMoveItem(item, -1)}
                    disabled={index === 0}
                    className="rounded p-0.5 text-ash transition-colors hover:text-gold disabled:opacity-30"
                    title="Move up"
                    aria-label={`Move ${item.title} up`}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveItem(item, 1)}
                    disabled={index === playlist.length - 1}
                    className="rounded p-0.5 text-ash transition-colors hover:text-gold disabled:opacity-30"
                    title="Move down"
                    aria-label={`Move ${item.title} down`}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {isHost && !isCurrent && (
                <button
                  type="button"
                  onClick={() => onSelectMovie(item)}
                  className="btn-gold h-8 w-8 shrink-0 rounded-full p-0"
                  title="Play this for everyone"
                  aria-label={`Play ${item.title}`}
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                </button>
              )}
              {isHost && onRemoveItem && (
                <button
                  type="button"
                  onClick={() => onRemoveItem(item)}
                  className="rounded-md p-1.5 text-ash transition-colors hover:bg-danger/15 hover:text-danger-bright"
                  title="Remove from queue"
                  aria-label={`Remove ${item.title} from queue`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
