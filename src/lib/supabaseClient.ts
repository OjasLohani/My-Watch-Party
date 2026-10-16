import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Requests that get no answer within this time fail instead of hanging */
const REQUEST_TIMEOUT_MS = 15_000;

/** fetch with a timeout, so slow or dropped connections surface as errors */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

/**
 * Official Supabase JavaScript client. Loaded on first use (see
 * getSupabase in ./supabase) so it is not part of the first page load.
 * Only the public anon/publishable key is used here, never a service key.
 */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
      // Heartbeats from a Web Worker keep the connection alive while the
      // tab is in the background (browsers slow down timers there).
      worker: true,
    },
  });
}
