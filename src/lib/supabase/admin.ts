import { createClient } from "@supabase/supabase-js";

/**
 * Admin (service role) Supabase client for privileged server-side operations.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be exposed to the
 * browser or imported by any client component. This client does not bind to
 * cookies and does not persist a session — it is used for one-off privileged
 * calls (e.g. `auth.signUp` during registration) so that no session cookie is
 * ever written to the current request/response by accident.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
