import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client — SERVER ONLY. Bypasses RLS; every route that uses it
 * must perform its own auth + role checks first (see lib/permissions.ts).
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin env vars missing');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
