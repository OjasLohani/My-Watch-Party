import { getSupabase } from './supabase';

let pendingSignIn: Promise<string> | null = null;

/**
 * Returns the Supabase Auth user id for this browser, signing in
 * anonymously the first time. Guests get a real, distinct identity
 * without creating an account; the session is persisted by supabase-js.
 *
 * Concurrent callers share one in-flight request, so React StrictMode's
 * double-invoked effects cannot create two anonymous users.
 */
export function ensureSignedIn(): Promise<string> {
  if (!pendingSignIn) {
    pendingSignIn = (async () => {
      const { data: sessionData, error: sessionError } = await (await getSupabase()).auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      if (sessionData.session?.user) return sessionData.session.user.id;

      const { data, error } = await (await getSupabase()).auth.signInAnonymously();
      if (error || !data.user) {
        const message = error?.message ?? 'Unknown sign-in error.';
        throw new Error(
          /anonymous/i.test(message)
            ? 'Guest sign-in is disabled. Enable "Allow anonymous sign-ins" in the Supabase dashboard.'
            : `Could not sign in: ${message}`
        );
      }
      return data.user.id;
    })().catch((err: unknown) => {
      // Allow a retry on the next call.
      pendingSignIn = null;
      throw err;
    });
  }
  return pendingSignIn;
}
