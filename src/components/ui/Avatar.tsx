import { useState } from 'react';
import { Crown } from 'lucide-react';

interface AvatarProps {
  name: string;
  src?: string;
  /** Background for the initials fallback */
  color?: string;
  /** Pixel size (default 36) */
  size?: number;
  /** true / false shows a presence dot; undefined shows none */
  online?: boolean;
  isHost?: boolean;
  className?: string;
}

/**
 * A participant's picture. Falls back to their initial when there is no
 * picture or it fails to load (never a stranger's photo).
 */
export function Avatar({ name, src, color = '#49382b', size = 36, online, isHost, className = '' }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  const dot = Math.max(8, Math.round(size * 0.28));

  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(src ?? null)}
          className="h-full w-full rounded-full object-cover ring-1 ring-bronze"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-ivory ring-1 ring-bronze"
          style={{ backgroundColor: color, fontSize: size * 0.4 }}
        >
          {initial}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 rounded-full ring-2 ring-surface ${online ? 'bg-success' : 'bg-ash-muted'}`}
          style={{ width: dot, height: dot }}
          title={online ? 'Online' : 'Offline'}
        />
      )}
      {isHost && (
        <span
          className="absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-gold text-[#1a1208] ring-2 ring-surface"
          style={{ width: dot + 6, height: dot + 6 }}
          title="Host"
        >
          <Crown className="h-[65%] w-[65%]" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
