import { useCallback, useState } from 'react';

// "My List": catalog movie ids saved on this device (localStorage).
// Not shared between devices or browsers: there is no account system.

const STORAGE_KEY = 'watchparty_watchlist';
const MAX_ITEMS = 200;

function readIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable (private window): the list lasts for this visit
  }
}

/** The saved list, plus a toggle that keeps it in the order movies were added */
export function useWatchlist(validIds: readonly string[]) {
  const [ids, setIds] = useState<string[]>(() => readIds().filter((id) => validIds.includes(id)));

  /** Adds or removes a movie; returns true if it was added */
  const toggle = useCallback((movieId: string): boolean => {
    const added = !ids.includes(movieId);
    const next = added ? [...ids, movieId].slice(-MAX_ITEMS) : ids.filter((id) => id !== movieId);
    writeIds(next);
    setIds(next);
    return added;
  }, [ids]);

  const has = useCallback((movieId: string) => ids.includes(movieId), [ids]);

  return { ids, has, toggle };
}
