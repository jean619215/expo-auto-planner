"use client";

import Link from "next/link";
import { useAuthStatus } from "@/lib/useAuthStatus";

const navLinkClassName =
  "text-sm font-medium text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50";

export default function Header() {
  const { state, loggingOut, logout } = useAuthStatus();

  return (
    <header
      data-testid="site-header"
      className="flex flex-wrap items-center justify-between gap-y-2 border-b border-black/12 px-4 py-3 dark:border-white/18"
    >
      <Link
        href="/"
        data-testid="header-home-link"
        className="font-semibold text-black dark:text-zinc-50"
      >
        展覽自動排程
      </Link>

      <nav className="flex flex-1 items-center justify-center gap-6">
        {state === "loggedIn" && (
          <>
            <Link
              href="/profile"
              data-testid="header-nav-profile-link"
              className={navLinkClassName}
            >
              個人資訊
            </Link>
            <Link
              href="/venue"
              data-testid="header-nav-venue-link"
              className={navLinkClassName}
            >
              場地規劃
            </Link>
          </>
        )}
      </nav>

      <div className="flex items-center gap-4">
        {state === "loading" && (
          <div
            data-testid="header-auth-loading"
            className="h-8 w-24 animate-pulse rounded bg-black/6 dark:bg-white/8"
          />
        )}
        {state === "loggedIn" && (
          <>
            <Link
              href="/profile"
              data-testid="header-profile-link"
              className={navLinkClassName}
            >
              個人資訊
            </Link>
            <button
              type="button"
              data-testid="header-logout-button"
              onClick={logout}
              disabled={loggingOut}
              className={`${navLinkClassName} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {loggingOut ? "登出中…" : "登出"}
            </button>
          </>
        )}
        {state === "loggedOut" && (
          <>
            <Link
              href="/login"
              data-testid="header-login-link"
              className={navLinkClassName}
            >
              登入
            </Link>
            <Link
              href="/register"
              data-testid="header-register-link"
              className={navLinkClassName}
            >
              註冊
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
