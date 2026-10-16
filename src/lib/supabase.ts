import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Validates whether genuine Supabase credentials have been configured
export const isSupabaseConfigured = (): boolean => {
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseAnonKey) &&
    !supabaseUrl.includes('your-project-ref') &&
    !supabaseAnonKey.includes('your-anon-public-key') &&
    supabaseUrl.startsWith('https://')
  );
};

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * The Supabase client. The library (~55 kB compressed) is downloaded on
 * first use instead of with the first page, so the homepage shows sooner.
 * Every call shares one client instance.
 */
export function getSupabase(): Promise<SupabaseClient> {
  clientPromise ??= import('./supabaseClient').then(
    ({ createSupabaseClient }) =>
      createSupabaseClient(
        isSupabaseConfigured() ? supabaseUrl : 'https://placeholder.supabase.co',
        isSupabaseConfigured() ? supabaseAnonKey : 'placeholder-key'
      ),
    (err: unknown) => {
      // Download failed (e.g. offline): let the next call try again
      clientPromise = null;
      throw err;
    }
  );
  return clientPromise;
}
