import { useState, useMemo } from 'react';
import { Search, X, Star, Play, Plus, Clock, SlidersHorizontal, Film } from 'lucide-react';
import type { Movie, SortOption } from '../types';
import { CATEGORIES } from '../mockData';

interface MovieGridProps {
  movies: Movie[];
  onPlayMovie: (movie: Movie) => void;
  onAddToPlaylist: (movie: Movie) => void;
}

export function MovieGrid({ movies, onPlayMovie, onAddToPlaylist }: MovieGridProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortOption>('rating-desc');

  // Filter and sort movies genuinely on the mock data
  const filteredMovies = useMemo(() => {
    return movies
      .filter((movie) => {
        const matchesCategory =
          selectedCategory === 'All' || movie.category.toLowerCase() === selectedCategory.toLowerCase();

        const query = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !query ||
          movie.title.toLowerCase().includes(query) ||
          movie.description.toLowerCase().includes(query) ||
          (movie.director && movie.director.toLowerCase().includes(query));

        return matchesCategory && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'rating-desc') return b.rating - a.rating;
        if (sortBy === 'year-desc') return b.year - a.year;
        if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
        if (sortBy === 'duration-asc') {
          const durA = parseInt(a.duration) || 0;
          const durB = parseInt(b.duration) || 0;
          return durA - durB;
        }
        return 0;
      });
  }, [movies, searchQuery, selectedCategory, sortBy]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSortBy('rating-desc');
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      {/* Section Title & Metrics */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">
            Screening Roster
          </span>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Club Cinema Library
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-400 max-w-xl">
            Selected independent classics and student cinema showcases calibrated for real-time synchronization.
          </p>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          Showing <span className="font-bold text-white">{filteredMovies.length}</span> of {movies.length} titles
        </div>
      </div>

      {/* Filter and Search Controls Bar */}
      <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-[#0A0C13] p-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, director, or keyword..."
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 transition-colors focus:border-violet-500/60 focus:bg-white/[0.05] focus:outline-none"
          />
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-slate-400 hover:text-white"
              aria-label="Clear search query"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Sorting Dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <SlidersHorizontal className="h-4 w-4 text-slate-400" />
          <span className="text-xs text-slate-400 hidden sm:inline">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="rounded-xl border border-white/[0.08] bg-[#11131E] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors focus:border-violet-500/50 focus:outline-none"
          >
            <option value="rating-desc">Highest Rated</option>
            <option value="year-desc">Newest Year</option>
            <option value="title-asc">Title (A-Z)</option>
            <option value="duration-asc">Shortest Duration</option>
          </select>
        </div>
      </div>

      {/* Category Pills */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CATEGORIES.map((category) => {
          const isActive = selectedCategory.toLowerCase() === category.toLowerCase();
          return (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              className={`rounded-full px-4 py-1.5 text-xs tracking-wide transition-all ${
                isActive
                  ? 'bg-violet-600 text-white font-semibold shadow-md shadow-violet-950/50'
                  : 'border border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Movie Cards Grid */}
      {filteredMovies.length > 0 ? (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {filteredMovies.map((movie) => (
            <div
              key={movie.id}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0A0C13] transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/40 hover:shadow-2xl hover:shadow-black"
            >
              {/* Artwork Container */}
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-950">
                <img
                  src={movie.posterUrl}
                  alt={movie.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    e.currentTarget.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80';
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0C13] via-[#0A0C13]/30 to-transparent"></div>

                {/* Rating Badge */}
                <div className="absolute top-3 right-3 flex items-center gap-1 rounded-md border border-white/10 bg-black/70 px-2 py-0.5 text-xs font-bold text-amber-300 backdrop-blur-md">
                  <Star className="h-3 w-3 fill-amber-300" />
                  {movie.rating}
                </div>

                {/* Category Tag */}
                <div className="absolute top-3 left-3 rounded-md border border-white/10 bg-black/70 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-300 uppercase backdrop-blur-md">
                  {movie.category}
                </div>
              </div>

              {/* Card Body */}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>{movie.year}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {movie.duration}
                  </span>
                </div>

                <h3 className="mt-2 text-base font-bold text-white group-hover:text-violet-300 transition-colors line-clamp-1">
                  {movie.title}
                </h3>

                <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                  {movie.description}
                </p>

                {/* Card Actions */}
                <div className="mt-auto pt-4 flex items-center gap-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => onPlayMovie(movie)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 py-2.5 text-xs font-semibold text-white shadow-sm transition-all"
                  >
                    <Play className="h-3.5 w-3.5 fill-white" />
                    Watch Now
                  </button>

                  <button
                    type="button"
                    onClick={() => onAddToPlaylist(movie)}
                    title="Add film to room queue"
                    className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors"
                    aria-label={`Add ${movie.title} to room queue`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Refined Empty State */
        <div className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-[#0A0C13]/50 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/[0.08] text-violet-400">
            <Film className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-white">No screening matches your criteria</h3>
          <p className="mt-1.5 max-w-sm text-xs text-slate-400 leading-relaxed">
            Try adjusting your search terms or picking another genre category from the list above.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-5 rounded-xl border border-violet-500/30 bg-violet-600/15 px-4 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-600/25 transition-colors"
          >
            Reset All Filters
          </button>
        </div>
      )}
    </section>
  );
}
