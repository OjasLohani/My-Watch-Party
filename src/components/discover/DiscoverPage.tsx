import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Plus, Check, Star, ChevronLeft, ChevronRight, ArrowRight, Users, ListPlus, Bookmark, BookmarkCheck,
  SlidersHorizontal, Film, Search, X,
} from 'lucide-react';
import type { Movie, SortOption } from '../../types';
import { CATEGORIES } from '../../mockData';
import { genresOf, searchMovies, sortMovies, stepMovie } from '../../lib/catalog';
import { Artwork } from '../ui/Artwork';
import type { NavTarget } from '../Navbar';
import { SECTIONS, scrollToSection } from './sections';

interface DiscoverPageProps {
  movies: Movie[];
  featuredId: string | undefined;
  /** Show a movie in the spotlight (never starts playback) */
  onFeature: (movieId: string) => void;
  /** The existing watch flow for a movie (room / create-room dialog) */
  onWatchNow: (movie: Movie) => void;
  /** Open "Create Room" with this movie preselected */
  onHostWithMovie: (movie: Movie) => void;
  onAddToQueue: (movie: Movie) => void;
  watchlist: { ids: string[]; has: (id: string) => boolean; toggle: (id: string) => boolean };
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** Called when a different section reaches the middle of the screen */
  onSectionChange: (target: NavTarget) => void;
}

export function DiscoverPage({
  movies,
  featuredId,
  onFeature,
  onWatchNow,
  onHostWithMovie,
  onAddToQueue,
  watchlist,
  searchQuery,
  onSearchChange,
  onSectionChange,
}: DiscoverPageProps) {
  const featured = movies.find((m) => m.id === featuredId) ?? movies[0];

  // Which section is in view (for the navigation underline)
  const sectionChangeRef = useRef(onSectionChange);
  useEffect(() => {
    sectionChangeRef.current = onSectionChange;
  });
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        const section = SECTIONS.find((s) => s.id === visible?.target.id);
        if (section) sectionChangeRef.current(section.target);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const { id } of SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const featureAndShow = (movieId: string) => {
    onFeature(movieId);
    scrollToSection('home');
  };

  if (!featured) return null;

  return (
    <div className="pb-24 md:pb-10">
      <FeaturedHero
        movie={featured}
        movies={movies}
        onFeature={onFeature}
        onWatchNow={onWatchNow}
        onHostWithMovie={onHostWithMovie}
        inWatchlist={watchlist.has(featured.id)}
        onToggleWatchlist={() => watchlist.toggle(featured.id)}
      />

      <section id="now-showing" aria-labelledby="now-showing-title" className="mx-auto max-w-[1440px] scroll-mt-20 px-4 pt-8 sm:px-8">
        <SectionHeading id="now-showing-title" title="Now Showing" action={{ label: 'View All', onClick: () => scrollToSection('library') }} />
        <div className="no-scrollbar -mx-4 mt-4 flex snap-x gap-3.5 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] lg:overflow-visible">
          {movies.map((movie) => (
            <PosterCard key={movie.id} movie={movie} selected={movie.id === featured.id} onSelect={() => featureAndShow(movie.id)} />
          ))}
        </div>
      </section>

      <LibrarySection
        movies={movies}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onFeature={featureAndShow}
        onWatchNow={onWatchNow}
        onAddToQueue={onAddToQueue}
        watchlist={watchlist}
      />

      <section id="my-list" aria-labelledby="my-list-title" className="mx-auto max-w-[1440px] scroll-mt-20 px-4 pt-12 sm:px-8">
        <SectionHeading id="my-list-title" title="My List" subtitle="Saved on this device" />
        {watchlist.ids.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-bronze px-6 py-10 text-center">
            <Bookmark className="h-7 w-7 text-gold-muted" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-ivory">Your list is empty</p>
            <p className="mt-1 max-w-sm text-xs text-ash">
              Use <span className="text-ivory">Add to My List</span> on any film to keep it here for later.
            </p>
          </div>
        ) : (
          <div className="no-scrollbar -mx-4 mt-4 flex gap-3.5 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] lg:overflow-visible">
            {watchlist.ids
              .map((id) => movies.find((m) => m.id === id))
              .filter((m): m is Movie => Boolean(m))
              .map((movie) => (
                <PosterCard key={movie.id} movie={movie} selected={movie.id === featured.id} onSelect={() => featureAndShow(movie.id)} />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------- hero

interface FeaturedHeroProps {
  movie: Movie;
  movies: Movie[];
  onFeature: (movieId: string) => void;
  onWatchNow: (movie: Movie) => void;
  onHostWithMovie: (movie: Movie) => void;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
}

function FeaturedHero({ movie, movies, onFeature, onWatchNow, onHostWithMovie, inWatchlist, onToggleWatchlist }: FeaturedHeroProps) {
  const topRated = useMemo(() => sortMovies(movies, 'rating-desc').slice(0, 4), [movies]);
  const genres = genresOf(movie);
  const position = movies.findIndex((m) => m.id === movie.id);

  return (
    <section
      id="home"
      aria-roledescription="carousel"
      aria-label="Featured film"
      className="relative isolate scroll-mt-20 overflow-hidden border-b border-bronze-soft"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'ArrowRight') onFeature(stepMovie(movies, movie.id, 1)!);
        if (e.key === 'ArrowLeft') onFeature(stepMovie(movies, movie.id, -1)!);
      }}
    >
      {/* Artwork of the featured film, graded warm and faded into the page */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Artwork
          key={movie.id}
          sources={[movie.backdropUrl, movie.posterUrl]}
          alt=""
          loading="eager"
          fetchPriority="high"
          className="h-full w-full object-cover object-[60%_35%] animate-fade-in [filter:sepia(0.5)_saturate(0.72)_hue-rotate(-8deg)_brightness(0.72)_contrast(1.08)]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/35 to-ink/10 lg:via-ink/10" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-ink via-ink/70 to-transparent md:block lg:w-[70%]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,transparent_40%,rgb(8_7_6/0.55)_100%)]" />
      </div>

      <div className="relative mx-auto grid max-w-[1440px] gap-8 px-4 sm:px-8 lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Film details */}
        <div className="flex min-h-[460px] flex-col justify-end pb-8 pt-40 sm:min-h-[520px] lg:min-h-0 lg:justify-center lg:pb-14 lg:pl-14 lg:pt-12">
          <div key={movie.id} className="max-w-[580px] animate-fade-up" aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ivory/85">
              {movie.category} {movie.category !== genres[0] && genres[0] ? `• ${genres[0]}` : ''}
            </p>
            <h1 className="mt-2 font-display text-[clamp(2.6rem,7vw,5.6rem)] font-bold uppercase leading-[0.92] tracking-[-0.01em] text-ivory [text-shadow:0_4px_30px_rgb(0_0_0/0.6)]">
              {movie.title}
            </h1>
            {movie.description && (
              <p className="mt-4 line-clamp-3 max-w-[460px] text-sm leading-relaxed text-ivory/80 sm:text-[15px]">
                {movie.description}
              </p>
            )}
            <MovieMeta movie={movie} genres={genres} className="mt-4" />
            {movie.director && <p className="mt-2 text-xs text-ash">Directed by <span className="text-ivory/90">{movie.director}</span></p>}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onWatchNow(movie)}
                className="btn-gold h-11 px-6 text-sm"
                aria-label={`Watch Now: ${movie.title}`}
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                Watch Now
              </button>
              <button
                type="button"
                onClick={onToggleWatchlist}
                aria-pressed={inWatchlist}
                className="btn-ghost h-11 px-5 text-sm"
              >
                {inWatchlist ? <Check className="h-4 w-4 text-gold" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                {inWatchlist ? 'In My List' : 'Add to My List'}
              </button>
              <button
                type="button"
                onClick={() => onHostWithMovie(movie)}
                className="btn-ghost h-11 w-11 border-bronze px-0"
                title={`Host a watch party with ${movie.title}`}
                aria-label={`Host a watch party with ${movie.title}`}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Position in the carousel (phones and tablets) */}
            <div className="mt-6 flex items-center gap-1.5 lg:hidden" aria-hidden="true">
              {movies.map((m, i) => (
                <span key={m.id} className={`h-1.5 rounded-full transition-all ${i === position ? 'w-5 bg-gold' : 'w-1.5 bg-ivory/30'}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Top rated films (desktop) */}
        <aside aria-labelledby="top-rated-title" className="hidden self-center lg:block">
          <div className="panel overflow-hidden border-bronze/80 bg-ink/70 backdrop-blur-sm">
            <h2 id="top-rated-title" className="px-4 pb-1 pt-4 font-display text-xl font-medium italic tracking-wide text-ivory">
              Top Rated
            </h2>
            <ul>
              {topRated.map((m) => {
                const selected = m.id === movie.id;
                return (
                  <li key={m.id} className="border-t border-bronze-soft first:border-t-0">
                    <button
                      type="button"
                      onClick={() => onFeature(m.id)}
                      aria-current={selected ? 'true' : undefined}
                      aria-label={`Show ${m.title} in the spotlight`}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selected ? 'bg-gold/[0.07]' : 'hover:bg-white/[0.03]'}`}
                    >
                      <span className={`h-[54px] w-[72px] shrink-0 overflow-hidden rounded-md border ${selected ? 'border-gold-muted' : 'border-bronze'} bg-surface-2`}>
                        <Artwork sources={[m.posterUrl, m.backdropUrl]} alt="" className="h-full w-full object-cover" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block truncate font-display text-[15px] font-medium ${selected ? 'text-gold' : 'text-ivory'}`}>{m.title}</span>
                        <span className="block text-[11px] text-ash">{m.category} • {m.year}</span>
                        <Rating value={m.rating} className="mt-0.5 text-[11px]" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>

      {/* Carousel arrows */}
      <button
        type="button"
        onClick={() => onFeature(stepMovie(movies, movie.id, -1)!)}
        className="btn-icon absolute left-3 top-24 h-10 w-10 sm:left-5 lg:top-1/2 lg:h-11 lg:w-11 lg:-translate-y-1/2"
        aria-label="Previous film"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => onFeature(stepMovie(movies, movie.id, 1)!)}
        className="btn-icon absolute right-3 top-24 h-10 w-10 sm:right-5 lg:right-[calc(max(2rem,calc((100vw-1440px)/2+2rem))+340px+3rem)] lg:top-1/2 lg:h-11 lg:w-11 lg:-translate-y-1/2"
        aria-label="Next film"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
      <p className="sr-only" aria-live="polite">
        Film {position + 1} of {movies.length}: {movie.title}
      </p>
    </section>
  );
}

function MovieMeta({ movie, genres, className = '' }: { movie: Movie; genres: string[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ivory/85 ${className}`}>
      {Number.isFinite(movie.rating) && <Rating value={movie.rating} className="text-[15px] font-semibold" />}
      {movie.year > 0 && <span>{movie.year}</span>}
      {movie.duration && <span>{movie.duration}</span>}
      {genres.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {genres.map((g) => (
            <span key={g} className="chip text-ivory/80">{g}</span>
          ))}
        </span>
      )}
    </div>
  );
}

function Rating({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-gold ${className}`}>
      <Star className="h-[1em] w-[1em] fill-gold" aria-hidden="true" />
      <span>
        <span className="sr-only">Rating </span>
        {value.toFixed(1)}
      </span>
    </span>
  );
}

// ------------------------------------------------------------- rows & cards

function SectionHeading({ id, title, subtitle, action }: {
  id: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 id={id} className="font-display text-[1.75rem] font-semibold italic leading-none tracking-wide text-ivory sm:text-[2rem]">
          {title}
        </h2>
        {subtitle && <p className="mt-1.5 text-xs text-ash">{subtitle}</p>}
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="flex items-center gap-1 text-xs text-ash transition-colors hover:text-gold">
          {action.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function PosterCard({ movie, selected, onSelect }: { movie: Movie; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Show ${movie.title} in the spotlight`}
      className={`group relative aspect-[8/7] w-[150px] shrink-0 snap-start overflow-hidden rounded-xl border bg-surface-2 text-left transition-[border-color,transform] duration-300 sm:w-[170px] lg:w-auto ${
        selected ? 'border-gold-muted shadow-[0_0_0_1px_rgb(242_210_123/0.35)]' : 'border-bronze hover:-translate-y-0.5 hover:border-gold-muted/70'
      }`}
    >
      <Artwork
        sources={[movie.posterUrl, movie.backdropUrl]}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] [filter:sepia(0.18)_saturate(0.9)]"
      />
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 p-2.5">
        <span className="block truncate font-display text-[15px] font-medium leading-tight text-ivory">{movie.title}</span>
        <Rating value={movie.rating} className="mt-0.5 text-[11px]" />
      </span>
    </button>
  );
}

// ------------------------------------------------------------- library

interface LibrarySectionProps {
  movies: Movie[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onFeature: (movieId: string) => void;
  onWatchNow: (movie: Movie) => void;
  onAddToQueue: (movie: Movie) => void;
  watchlist: { has: (id: string) => boolean; toggle: (id: string) => boolean };
}

function LibrarySection({ movies, searchQuery, onSearchChange, onFeature, onWatchNow, onAddToQueue, watchlist }: LibrarySectionProps) {
  const [category, setCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortOption>('rating-desc');

  const shown = useMemo(() => {
    const inCategory = movies.filter((m) => category === 'All' || m.category.toLowerCase() === category.toLowerCase());
    return sortMovies(searchMovies(inCategory, searchQuery), sortBy);
  }, [movies, category, searchQuery, sortBy]);

  const reset = () => {
    setCategory('All');
    setSortBy('rating-desc');
    onSearchChange('');
  };

  return (
    <section id="library" aria-labelledby="library-title" className="mx-auto max-w-[1440px] scroll-mt-20 px-4 pt-12 sm:px-8">
      <SectionHeading id="library-title" title="The Library" subtitle={`Showing ${shown.length} of ${movies.length} films`} />

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
          {CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                  active ? 'border-gold-muted bg-gold/10 font-semibold text-gold' : 'border-bronze text-ash hover:border-gold-muted/60 hover:text-ivory'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 lg:w-60 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ash" aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter the library…"
              aria-label="Filter the library"
              className="field h-9 py-0 pl-8 text-xs"
            />
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-ash">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="field h-9 w-auto py-0 pl-3 pr-8 text-xs">
              <option value="rating-desc">Highest rated</option>
              <option value="year-desc">Newest</option>
              <option value="title-asc">Title (A–Z)</option>
              <option value="duration-asc">Shortest</option>
            </select>
          </label>
        </div>
      </div>

      {shown.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {shown.map((movie) => (
            <li key={movie.id} className="group flex flex-col overflow-hidden rounded-xl border border-bronze-soft bg-surface transition-colors hover:border-bronze">
              <button
                type="button"
                onClick={() => onFeature(movie.id)}
                className="relative aspect-[16/10] overflow-hidden bg-surface-2"
                aria-label={`Show ${movie.title} in the spotlight`}
              >
                <Artwork
                  sources={[movie.posterUrl, movie.backdropUrl]}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] [filter:sepia(0.15)_saturate(0.9)]"
                />
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-surface/90 via-transparent to-transparent" />
                <span className="absolute right-2.5 top-2.5 rounded-md border border-bronze bg-ink/75 px-1.5 py-0.5 text-[11px]">
                  <Rating value={movie.rating} />
                </span>
                <span className="absolute left-2.5 top-2.5 rounded-md border border-bronze bg-ink/75 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ivory/85">
                  {movie.category}
                </span>
              </button>
              <div className="flex flex-1 flex-col p-3.5">
                <h3 className="truncate font-display text-lg font-medium text-ivory">{movie.title}</h3>
                <p className="text-[11px] text-ash">{movie.year} • {movie.duration}</p>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ash">{movie.description}</p>
                <div className="mt-auto flex items-center gap-2 pt-3.5">
                  <button type="button" onClick={() => onWatchNow(movie)} className="btn-ghost h-9 flex-1 border-bronze text-xs" aria-label={`Watch Now: ${movie.title}`}>
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Watch Now
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToQueue(movie)}
                    className="btn-icon h-9 w-9 rounded-lg"
                    title="Add to the room queue"
                    aria-label={`Add ${movie.title} to room queue`}
                  >
                    <ListPlus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => watchlist.toggle(movie.id)}
                    aria-pressed={watchlist.has(movie.id)}
                    className="btn-icon h-9 w-9 rounded-lg"
                    title={watchlist.has(movie.id) ? 'Remove from My List' : 'Add to My List'}
                    aria-label={`${watchlist.has(movie.id) ? 'Remove' : 'Add'} ${movie.title} ${watchlist.has(movie.id) ? 'from' : 'to'} My List`}
                  >
                    {watchlist.has(movie.id) ? <BookmarkCheck className="h-4 w-4 text-gold" /> : <Bookmark className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-bronze px-6 py-12 text-center">
          <Film className="h-7 w-7 text-gold-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ivory">No film matches</p>
          <p className="mt-1 text-xs text-ash">Try another search or category.</p>
          <button type="button" onClick={reset} className="btn-ghost mt-4 h-9 border-bronze px-4 text-xs">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </button>
        </div>
      )}
    </section>
  );
}
