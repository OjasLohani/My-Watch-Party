/** Watch Party monogram ("WP"), optionally with the wordmark */
export function Logo({ withWordmark = false, className = '' }: { withWordmark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className="font-display text-[1.65rem] font-bold italic leading-none tracking-[-0.06em] text-ivory [text-shadow:0_2px_12px_rgb(242_210_123/0.25)]"
      >
        W<span className="text-gold">P</span>
      </span>
      {withWordmark ? (
        <span className="hidden font-display text-[0.95rem] font-semibold uppercase tracking-[0.18em] text-ivory sm:inline">
          Watch Party
        </span>
      ) : (
        <span className="sr-only">Watch Party</span>
      )}
    </span>
  );
}
