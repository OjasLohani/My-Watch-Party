import { useId, useMemo, useRef, useState } from 'react';
import { Search, X, Plus, LogIn, Pencil, Star } from 'lucide-react';
import type { Movie, User } from '../types';
import { searchMovies } from '../lib/catalog';
import { Logo } from './ui/Logo';
import { Avatar } from './ui/Avatar';

/** Places the top navigation can take you (all on existing pages) */
export type NavTarget = 'home' | 'categories' | 'movies' | 'mylist' | 'room';

interface NavbarProps {
  activeTarget: NavTarget;
  onNavigate: (target: NavTarget) => void;
  currentUser: User;
  /** Label for the room link (the current room's code) */
  roomCode: string;
  /** True while connected to a real (shared) room */
  isInLiveRoom: boolean;
  movies: Movie[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** A search result was chosen: show it in the spotlight */
  onSelectSearchResult: (movie: Movie) => void;
  /** Phones: the search row is shown (opened from the bottom navigation) */
  mobileSearchOpen: boolean;
  onMobileSearchOpenChange: (open: boolean) => void;
  onOpenCreateModal: () => void;
  onOpenJoinModal: () => void;
  onToggleHostRole: () => void;
  /** False in real rooms, where the database decides who is host */
  canToggleHostRole?: boolean;
  /** Opens the "change your name" dialog */
  onEditName?: () => void;
}

const LINKS: { target: NavTarget; label: string }[] = [
  { target: 'home', label: 'Home' },
  { target: 'categories', label: 'Categories' },
  { target: 'movies', label: 'Movies' },
  { target: 'mylist', label: 'My List' },
  { target: 'room', label: 'My Room' },
];

const MAX_RESULTS = 6;

export function Navbar({
  activeTarget,
  onNavigate,
  currentUser,
  roomCode,
  isInLiveRoom,
  movies,
  searchQuery,
  onSearchChange,
  onSelectSearchResult,
  mobileSearchOpen,
  onMobileSearchOpenChange,
  onOpenCreateModal,
  onOpenJoinModal,
  onToggleHostRole,
  canToggleHostRole = true,
  onEditName,
}: NavbarProps) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-40 w-full border-b border-bronze-soft bg-ink/85 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-3 sm:gap-4 sm:px-8">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="shrink-0 rounded-md"
          aria-label="Watch Party home"
        >
          <Logo />
        </button>

        {/* Page sections (tablet and up; phones use the bottom bar) */}
        <ul className="ml-2 hidden items-center gap-0.5 md:flex xl:ml-8 xl:gap-3">
          {LINKS.map(({ target, label }) => {
            const active = activeTarget === target;
            return (
              <li key={target}>
                <button
                  type="button"
                  onClick={() => onNavigate(target)}
                  aria-current={active ? 'page' : undefined}
                  title={target === 'room' ? `Room ${roomCode}` : undefined}
                  className={`relative whitespace-nowrap px-1.5 py-5 text-[13px] transition-colors lg:px-2 lg:text-[13.5px] xl:px-2.5 ${
                    active ? 'font-semibold text-gold' : 'text-ash hover:text-ivory'
                  }`}
                >
                  {label}
                  {target === 'room' && isInLiveRoom && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" aria-label="(live)" />
                  )}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-2.5 bottom-3 h-0.5 rounded-full bg-gold transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => onMobileSearchOpenChange(!mobileSearchOpen)}
            aria-expanded={mobileSearchOpen}
            className="btn-icon hidden h-9 w-9 md:inline-flex xl:hidden"
            aria-label="Search films"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="hidden w-[min(22rem,26vw)] xl:block">
            <SearchBox
              movies={movies}
              query={searchQuery}
              onQueryChange={onSearchChange}
              onSelect={onSelectSearchResult}
            />
          </div>

          <button
            type="button"
            onClick={onOpenJoinModal}
            className="btn-ghost h-9 whitespace-nowrap border-bronze px-3 text-xs"
          >
            <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">Join Room</span>
          </button>
          <button type="button" onClick={onOpenCreateModal} className="btn-gold h-9 whitespace-nowrap px-3.5 text-xs">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden min-[400px]:inline">Create Room</span>
            <span className="min-[400px]:hidden">Create</span>
          </button>

          {/* Profile: name and role; in demo rooms a click switches role */}
          <div className="flex items-center gap-0.5 border-l border-bronze-soft pl-1.5 sm:gap-1 sm:pl-3">
            <button
              type="button"
              onClick={canToggleHostRole ? onToggleHostRole : undefined}
              disabled={!canToggleHostRole}
              title={`Role: ${currentUser.isHost ? 'Host' : 'Viewer'}${canToggleHostRole ? ' • Click to switch (demo room)' : ''}`}
              className="flex items-center gap-2 rounded-full p-0.5 pr-1 disabled:cursor-default xl:pr-2"
            >
              <Avatar name={currentUser.name} src={currentUser.avatar} color={currentUser.color} size={34} />
              <span className="hidden max-w-[9rem] text-left xl:block">
                <span className="block truncate text-xs font-semibold text-ivory">{currentUser.name}</span>
                <span className="block text-[10px] text-ash">{currentUser.isHost ? 'Host' : 'Viewer'}</span>
              </span>
            </button>
            {onEditName && (
              <button
                type="button"
                onClick={onEditName}
                className="rounded-md p-1.5 text-ash transition-colors hover:bg-white/[0.06] hover:text-gold"
                title="Change your name"
                aria-label="Change your name"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Phones and tablets: search row (opened from the bottom bar or the icon) */}
      {mobileSearchOpen && (
        <div className="border-t border-bronze-soft px-4 py-2.5 xl:hidden">
          <SearchBox
            movies={movies}
            query={searchQuery}
            onQueryChange={onSearchChange}
            onSelect={(movie) => {
              onSelectSearchResult(movie);
              onMobileSearchOpenChange(false);
            }}
            autoFocus
            onClose={() => onMobileSearchOpenChange(false)}
          />
        </div>
      )}
    </nav>
  );
}

interface SearchBoxProps {
  movies: Movie[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (movie: Movie) => void;
  autoFocus?: boolean;
  onClose?: () => void;
}

/** Search field with a keyboard-friendly list of matching films */
function SearchBox({ movies, query, onQueryChange, onSelect, autoFocus, onClose }: SearchBoxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => (query.trim() ? searchMovies(movies, query).slice(0, MAX_RESULTS) : []), [movies, query]);
  const showList = open && query.trim().length > 0;
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));

  const choose = (movie: Movie) => {
    onSelect(movie);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search films"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${results[active].id}` : undefined}
        value={query}
        autoFocus={autoFocus}
        placeholder="Search films, genres, directors…"
        onChange={(e) => {
          onQueryChange(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && showList && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') {
            if (query) onQueryChange('');
            else onClose?.();
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-full border border-bronze bg-surface/80 pl-10 pr-9 text-[13px] text-ivory placeholder:text-ash-muted transition-colors focus:border-gold-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            onQueryChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-ash hover:text-ivory"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching films"
          className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-bronze bg-surface shadow-[0_24px_48px_-16px_rgb(0_0_0/0.9)] animate-fade-in"
        >
          {results.length === 0 && (
            <li className="px-4 py-3 text-xs text-ash" role="option" aria-selected="false" aria-disabled="true">
              No films match “{query.trim()}”.
            </li>
          )}
          {results.map((movie, i) => (
            <li
              key={movie.id}
              id={`${listId}-${movie.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(movie);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? 'bg-surface-3' : ''}`}
            >
              <img src={movie.posterUrl} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ivory">{movie.title}</span>
                <span className="block text-[11px] text-ash">
                  {movie.category} • {movie.year}
                </span>
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-gold">
                <Star className="h-3 w-3 fill-gold" aria-hidden="true" />
                {movie.rating}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
