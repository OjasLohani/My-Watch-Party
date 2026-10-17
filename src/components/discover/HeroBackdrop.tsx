import { useEffect, useRef, useState } from 'react';
import type { Movie } from '../../types';

/** One background image; null src = no artwork (the dark page shows) */
type Layer = { key: number; movieId: string; src: string | null };

/** Loads and decodes the first image that works, so it can appear without flicker */
function loadFirst(sources: string[]): Promise<string | null> {
  return sources.reduce<Promise<string | null>>(
    (previous, src) => previous.then((found) => {
      if (found) return found;
      return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          // decode() avoids a half-painted frame; fall back if unsupported
          (img.decode?.() ?? Promise.resolve()).catch(() => {}).then(() => resolve(src));
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }),
    Promise.resolve(null),
  );
}

const sourcesOf = (movie: Movie) => [movie.backdropUrl, movie.posterUrl].filter(Boolean);

interface HeroBackdropProps {
  movie: Movie;
  /** Films next to this one in the carousel: their art is loaded ahead of time */
  neighbours: Movie[];
}

/**
 * Featured-film background with a crossfade: the new image (preloaded and
 * decoded first) fades and settles in from a slight zoom on top of the old
 * one, which is removed only once it is fully covered, so the background
 * is never blank. Fast clicking just stacks layers; the newest always wins.
 */
export function HeroBackdrop({ movie, neighbours }: HeroBackdropProps) {
  const nextKey = useRef(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  const wantedRef = useRef(movie.id);

  useEffect(() => {
    wantedRef.current = movie.id;
    let cancelled = false;
    void loadFirst(sourcesOf(movie)).then((src) => {
      // A newer film was chosen while this one loaded: skip it
      if (cancelled || wantedRef.current !== movie.id) return;
      setLayers((prev) => {
        if (prev.at(-1)?.movieId === movie.id) return prev;
        return [...prev, { key: nextKey.current++, movieId: movie.id, src }];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [movie]);

  // Warm the cache for the arrows' next / previous films
  useEffect(() => {
    const handle = setTimeout(() => {
      for (const m of neighbours) {
        const src = sourcesOf(m)[0];
        if (src) new Image().src = src;
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [neighbours]);

  /** A layer finished fading in: everything under it is hidden, drop it */
  const settled = (key: number) => setLayers((prev) => {
    const index = prev.findIndex((l) => l.key === key);
    return index > 0 ? prev.slice(index) : prev;
  });

  return (
    <>
      {layers.map((layer) => (
        <div
          key={layer.key}
          data-hero-layer={layer.movieId}
          className={`absolute inset-0 ${layer.key === 0 ? 'animate-fade-in' : 'animate-hero-in'}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) settled(layer.key);
          }}
        >
          {layer.src && (
            <img
              src={layer.src}
              alt=""
              fetchPriority={layer.key === 0 ? 'high' : undefined}
              className="h-full w-full object-cover object-[60%_35%] [filter:sepia(0.5)_saturate(0.72)_hue-rotate(-8deg)_brightness(0.72)_contrast(1.08)]"
            />
          )}
        </div>
      ))}
    </>
  );
}
