"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutRequest } from "@/lib/auth-client";

export type AuthState = "loading" | "loggedIn" | "loggedOut";

/**
 * Shared login-state detection + logout hook (extracted verbatim, not
 * rewritten, from the original client-side auth-nav implementation) so any
 * consumer gets identical behavior: GET /api/profile (200=loggedIn /
 * 401=loggedOut), and a logout() action that calls logoutRequest() +
 * router.refresh().
 *
 * Detection re-runs on every pathname change (not just first mount). This
 * hook now lives in a component mounted once in RootLayout instead of being
 * remounted per page visit (as the extracted-from component was, at the home
 * page). Without re-running on navigation, a client-side transition such as
 * the login page's `router.push("/")` after a successful login would never
 * be observed, leaving the header stuck showing the pre-login state. This
 * is still purely navigation-triggered (no polling, no cross-tab sync).
 */
export function useAuthStatus() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AuthState>("loading");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    // Login state is inferred from our own API: GET /api/profile returns 200
    // when authenticated and 401 (via the proxy) when not. We never call the
    // Supabase client from the browser.
    fetch("/api/profile", { credentials: "same-origin" })
      .then((res) => {
        if (!active) return;
        setState(res.ok ? "loggedIn" : "loggedOut");
      })
      .catch(() => {
        if (active) setState("loggedOut");
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutRequest();
      setState("loggedOut");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return { state, loggingOut, logout };
}
