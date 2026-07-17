import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Public API paths that do not require an authenticated user. Matched by
// exact pathname (not prefix) so newly added `/api/auth/*` routes are
// protected by default (fail-closed) — must be added here explicitly.
const PUBLIC_API_PATHS = new Set([
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/confirm",
  "/api/auth/logout",
  "/api/auth/resend",
  // 金流商 server-to-server 通知,不帶使用者 cookie。守門靠路由內的
  // 簽章驗證(見 src/app/api/points/webhook/mock/route.ts),驗簽失敗一律拒絕。
  "/api/points/webhook/mock",
]);

const NOT_LOGGED_IN_ERROR = "請先登入"; // aligned with src/app/api/profile/route.ts

// 未登入不可見的頁面。新增受保護頁面: 加到這裡 + 加到下方 config.matcher。
const PROTECTED_PAGES = ["/profile", "/shop"];
// 已登入不該再看的頁面 (導回首頁)。新增時同樣要同步 config.matcher。
const AUTH_PAGES = ["/login", "/register"];
const LOGIN_PATH = "/login"; // redirect 目標為固定常數 — 不取自 query/header,無 open redirect
const HOME_PATH = "/";

// 等於或前綴 (path + "/") 匹配,對齊 matcher 的 anchoring 語義,子路徑 fail-closed。
function matchesPage(pathname: string, pages: string[]): boolean {
  return pages.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// 把 base response 上的 (可能含 session 刷新的) cookie 轉移到另一個要回傳的
// response 上,確保無論走哪個分支都不會遺失 Set-Cookie。
function withCookiesFrom(base: NextResponse, target: NextResponse): NextResponse {
  base.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export async function proxy(request: NextRequest) {
  // Always refresh the session first, even for public paths, so a logged-in
  // user stays logged in across public auth calls too.
  const { response, user } = await updateSession(request);

  // `request.nextUrl.pathname` is already normalized by Next.js (e.g.
  // `/api/auth/../profile` resolves before reaching here), so an exact Set
  // comparison is safe against `..` traversal bypass attempts.
  const { pathname } = request.nextUrl;

  const isApiRequest = pathname.startsWith("/api/");

  if (!isApiRequest) {
    if (!user && matchesPage(pathname, PROTECTED_PAGES)) {
      return withCookiesFrom(response, NextResponse.redirect(new URL(LOGIN_PATH, request.url)));
    }
    if (user && matchesPage(pathname, AUTH_PAGES)) {
      return withCookiesFrom(response, NextResponse.redirect(new URL(HOME_PATH, request.url)));
    }
    return response;
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
    return response;
  }

  if (!user) {
    const unauthorized = NextResponse.json(
      { error: NOT_LOGGED_IN_ERROR },
      { status: 401 }
    );
    return withCookiesFrom(response, unauthorized);
  }

  return response;
}

export const config = {
  // 注意: matcher 必須是靜態字面值 (Next.js build 時分析,變數會被忽略)。
  // 新增受保護/auth 頁面時,需同步修改上方常數與這裡。
  matcher: ["/api/:path*", "/profile", "/login", "/register", "/shop", "/shop/:path*"],
};
