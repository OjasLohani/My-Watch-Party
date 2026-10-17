import type { Movie, SortOption } from '../types';

/** Movies whose title, description, director or genre contain the query */
export function searchMovies(movies: Movie[], query: string): Movie[] {
  const q = query.trim().toLowerCase();
  if (!q) return movies;
  return movies.filter((m) =>
    [m.title, m.description, m.director ?? '', m.genre, m.category].some((text) => text.toLowerCase().includes(q)));
}

export function sortMovies(movies: Movie[], sortBy: SortOption): Movie[] {
  return [...movies].sort((a, b) => {
    if (sortBy === 'rating-desc') return b.rating - a.rating;
    if (sortBy === 'year-desc') return b.year - a.year;
    if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
    if (sortBy === 'duration-asc') return (parseInt(a.duration) || 0) - (parseInt(b.duration) || 0);
    return 0;
  });
}

/** "Sci-Fi / Cyberpunk" → ["Sci-Fi", "Cyberpunk"] */
export function genresOf(movie: Movie): string[] {
  return movie.genre.split('/').map((g) => g.trim()).filter(Boolean);
}

/** The movie to feature first: the first one marked featured, else the first */
export function defaultFeaturedId(movies: Movie[]): string | undefined {
  return (movies.find((m) => m.featured) ?? movies[0])?.id;
}

/** Next / previous movie in catalog order (wraps around) */
export function stepMovie(movies: Movie[], currentId: string | undefined, step: 1 | -1): string | undefined {
  if (movies.length === 0) return undefined;
  const index = Math.max(0, movies.findIndex((m) => m.id === currentId));
  return movies[(index + step + movies.length) % movies.length].id;
}
