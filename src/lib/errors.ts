/**
 * Turns an error from Supabase / fetch into a message a person can act on.
 * Messages raised by our own database functions are already readable and
 * are passed through unchanged.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const message =
    err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : '';
  const name = err && typeof err === 'object' && 'name' in err && typeof err.name === 'string' ? err.name : '';

  if (name === 'TimeoutError' || /timed? ?out|signal timed out/i.test(message)) {
    return 'The server is taking too long to answer. Check your connection and try again.';
  }
  if (name === 'AbortError' || /failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return 'Network problem: check your internet connection and try again.';
  }
  if (/JWT|token is expired|invalid claim/i.test(message)) {
    return 'Your session expired. Please reload the page.';
  }
  return message || fallback;
}
