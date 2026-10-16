import type { FloatingReaction } from '../../types';

interface FloatingReactionsProps {
  reactions: FloatingReaction[];
}

export function FloatingReactions({ reactions }: FloatingReactionsProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {reactions.map((reaction) => (
        <div
          key={reaction.id}
          style={{ left: `${reaction.x}%` }}
          className="absolute bottom-8 -translate-x-1/2 text-3xl sm:text-4xl animate-reaction-float filter drop-shadow-[0_8px_16px_rgba(0,0,0,0.8)]"
        >
          <span className="inline-block select-none">{reaction.emoji}</span>
        </div>
      ))}
    </div>
  );
}
