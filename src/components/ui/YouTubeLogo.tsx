/** YouTube's play-button logo in its brand red (decorative; label it in text) */
export function YouTubeLogo({ className = 'h-5 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 20" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#FF0000"
        d="M27.4 3.1A3.5 3.5 0 0 0 25 .6C22.8 0 14 0 14 0S5.2 0 3 .6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9A3.5 3.5 0 0 0 3 19.4C5.2 20 14 20 14 20s8.8 0 11-.6a3.5 3.5 0 0 0 2.4-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z"
      />
      <path fill="#FFFFFF" d="M11.2 14.3 18.5 10l-7.3-4.3v8.6Z" />
    </svg>
  );
}
