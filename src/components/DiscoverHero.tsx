import { useState } from 'react';
import { Play, Plus, Star, ChevronRight, ChevronLeft } from 'lucide-react';
import type { Movie } from '../types';

interface DiscoverHeroProps {
  featuredMovies: Movie[];
  onPlayMovieInRoom: (movie: Movie) => void;
  onOpenCreateModalWithMovie: (movie: Movie) => void;
}

export function DiscoverHero({
  featuredMovies,
  onPlayMovieInRoom,
  onOpenCreateModalWithMovie,
}: DiscoverHeroProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const movie = featuredMovies[activeIndex] || featuredMovies[0];

  if (!movie) return null;

  const nextHero = () => {
    setActiveIndex((prev) => (prev + 1) % featuredMovies.length);
  };

  const prevHero = () => {
    setActiveIndex((prev) => (prev - 1 + featuredMovies.length) % featuredMovies.length);
  };

  return (
    <section className="relative overflow-hidden border-b border-white/[0.08] bg-[#06070B]">
      {/* High-res cinematic backdrop with seamless edge masking */}
      <div className="absolute inset-0 z-0">
        <img
          src={movie.backdropUrl}
          alt={movie.title}
          className="h-full w-full object-cover object-center opacity-35 transition-all duration-1000 transform scale-100"
          onError={(e) => {
            e.currentTarget.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1600&auto=format&fit=crop&q=80';
          }}
        />
        {/* Cinema Vignette Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/70 to-transparent"></div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#06070B] via-[#06070B]/85 to-transparent"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          {/* Metadata Badges */}
          <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-semibold tracking-wider uppercase">
            <span className="rounded-md bg-violet-500/15 border border-violet-500/30 px-2.5 py-1 text-violet-300">
              Club Spotlight
            </span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">
              {movie.category}
            </span>
            <span className="flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-300 font-bold">
              <Star className="h-3 w-3 fill-amber-300" />
              {movie.rating}
            </span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-slate-400 font-mono">
              4K STREAM
            </span>
          </div>

          {/* Title */}
          <h1 className="mt-4 text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
            {movie.title}
          </h1>

          {/* Subtitle & Credits */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-400">
            <span>{movie.year}</span>
            <span className="text-white/20">•</span>
            <span>{movie.duration}</span>
            <span className="text-white/20">•</span>
            <span>Directed by <span className="text-slate-300 font-semibold">{movie.director || 'Independent Filmmaker'}</span></span>
          </div>

          {/* Synopsis */}
          <p className="mt-4 text-sm sm:text-base leading-relaxed text-slate-300 line-clamp-3 max-w-xl">
            {movie.description}
          </p>

          {/* Action CTAs */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onPlayMovieInRoom(movie)}
              className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 px-6 py-3.5 text-xs sm:text-sm font-bold text-white shadow-xl shadow-violet-950/60 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Play className="h-4 w-4 fill-white" />
              Watch in Party Room
            </button>

            <button
              type="button"
              onClick={() => onOpenCreateModalWithMovie(movie)}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-xs sm:text-sm font-semibold text-slate-200 transition-all hover:bg-white/[0.08] hover:text-white"
            >
              <Plus className="h-4 w-4" />
              Host Room for this Film
            </button>
          </div>
        </div>

        {/* Hero Slider Bar */}
        <div className="mt-14 flex items-center justify-between border-t border-white/[0.08] pt-4">
          <div className="flex items-center gap-3">
            {featuredMovies.map((m, idx) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                aria-label={`Select featured film ${m.title}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  activeIndex === idx ? 'w-8 bg-violet-400' : 'w-2 bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
            <span className="ml-2 text-[11px] text-slate-400 font-mono hidden sm:inline">
              0{activeIndex + 1} / 0{featuredMovies.length} Featured Screenings
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prevHero}
              aria-label="Previous film"
              className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={nextHero}
              aria-label="Next film"
              className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
