"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutRequest } from "@/lib/auth-client";

type AuthState = "loading" | "loggedIn" | "loggedOut";

export default function AuthNav() {
  const router = useRouter();
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
  }, []);

  async function handleLogout() {
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

  if (state === "loading") {
    return (
      <div className="h-11 w-40 animate-pulse rounded-full bg-black/6 dark:bg-white/8" />
    );
  }

  if (state === "loggedIn") {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="flex h-11 items-center justify-center rounded-full border border-black/12 px-6 font-medium transition-colors hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/18 dark:hover:bg-white/6"
      >
        {loggingOut ? "登出中…" : "登出"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link
        href="/login"
        className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        登入
      </Link>
      <Link
        href="/register"
        className="flex h-11 items-center justify-center rounded-full border border-black/12 px-6 font-medium transition-colors hover:bg-black/4 dark:border-white/18 dark:hover:bg-white/6"
      >
        註冊
      </Link>
    </div>
  );
}
