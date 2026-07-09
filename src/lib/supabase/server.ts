import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * User-context Supabase client for use inside Route Handlers.
 *
 * Binds to Next.js's `cookies()` store so `@supabase/ssr` can read/write the
 * httpOnly session cookie automatically (login/logout/confirm auth calls).
 * Only reads the publishable key — never the service role key.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}
