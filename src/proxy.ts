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
]);

const NOT_LOGGED_IN_ERROR = "請先登入"; // aligned with src/app/api/profile/route.ts

export async function proxy(request: NextRequest) {
  // Always refresh the session first, even for public paths, so a logged-in
  // user stays logged in across public auth calls too.
  const { response, user } = await updateSession(request);

  // `request.nextUrl.pathname` is already normalized by Next.js (e.g.
  // `/api/auth/../profile` resolves before reaching here), so an exact Set
  // comparison is safe against `..` traversal bypass attempts.
  const { pathname } = request.nextUrl;

  if (PUBLIC_API_PATHS.has(pathname)) {
    return response;
  }

  if (!user) {
    const unauthorized = NextResponse.json(
      { error: NOT_LOGGED_IN_ERROR },
      { status: 401 }
    );
    response.cookies.getAll().forEach((cookie) => {
      unauthorized.cookies.set(cookie);
    });
    return unauthorized;
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
