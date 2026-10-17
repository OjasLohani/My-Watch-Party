import { useState } from 'react';

interface ArtworkProps {
  /** Tried in order; if all fail nothing is shown (the dark background stays) */
  sources: (string | undefined)[];
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  fetchPriority?: 'high' | 'low' | 'auto';
}

/**
 * Movie artwork that degrades gracefully: falls back to the movie's other
 * image, then to nothing, never to a broken-image icon or another film's art.
 */
export function Artwork({ sources, alt, className = '', loading = 'lazy', fetchPriority }: ArtworkProps) {
  const list = sources.filter((s): s is string => Boolean(s));
  const key = list.join('|');
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 });
  const failedCount = failed.key === key ? failed.count : 0;
  const src = list[failedCount];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      onError={() => setFailed({ key, count: failedCount + 1 })}
      className={className}
    />
  );
}
