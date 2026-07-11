# Project Documentation
> Generated: 2026-07-08 | Mode: FULL | Last delta: 2026-07-11 (membership tasks 5-9, story complete)

## Tech Stack
- Runtime: Node.js 22.21.1 (pinned in `.nvmrc`)
- Language: TypeScript (strict mode)
- Framework: Next.js 16.2.10 (App Router) — **non-standard version, breaking changes from training data. Consult `node_modules/next/dist/docs/` before writing framework-specific code.**
- Database: Postgres via Supabase (Auth + Postgres). Server-side access only, through our own Next.js API routes.
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`)
- State Management: none yet (no state library installed)

## Dependencies
- Core: next@16.2.10, react@19.2.4, react-dom@19.2.4, @supabase/supabase-js@^2.109.0, @supabase/ssr@^0.12.0
- Dev: typescript@5, eslint@9, eslint-config-next@16.2.10, tailwindcss@4, supabase@^2.109.1 (CLI), @playwright/test@^1.61.1, @types/node, @types/react, @types/react-dom

## Architecture Pattern
Next.js App Router with backend logic co-located in API route handlers. Supabase is infrastructure only (Auth + Postgres) — the frontend never calls the Supabase client directly; all access flows through our own `/api/*` routes, which use the Supabase server-side SDK. RLS is a second line of defense, not the sole guard.

## Folder Structure
```
src/app/           — App Router routes (layout.tsx, page.tsx, login/, register/, profile/)
src/app/api/       — API route handlers (auth/register|login|logout|confirm|resend, profile)
src/components/    — shared client components (AuthNav.tsx: infers logged-in state via GET /api/profile)
src/lib/supabase/  — Supabase client factories (server.ts, admin.ts) + proxy helper (middleware.ts)
src/lib/           — auth-client.ts (fetch wrapper), validation.ts, profile-client.ts, resend-cooldown.ts (localStorage helper)
src/proxy.ts       — Next.js 16 root proxy (formerly middleware.ts): API auth gate + page route protection + session refresh
supabase/          — CLI project: migrations, config.toml, tests (manual checklists, insomnia collection)
playwright-tests/  — Playwright E2E suite (page-object pattern in playwright-tests/pages/), used as the FRONTEND acceptance gate
playwright.config.ts — Playwright config
public/            — static assets
specs/             — project spec docs (OVERVIEW.md: tech decisions, open questions)
stories/           — ship-mate pipeline story files
.claude/           — Claude Code config, agents, pipeline state
```

## Code Style Conventions
- Path alias `@/*` → `./src/*`
- ESLint via `eslint-config-next` (core-web-vitals + typescript)
- API route handlers return JSON with a `{ "error": "..." }` shape on failure; user-facing messages in Traditional Chinese
- Supabase clients constructed via factory functions in `src/lib/supabase/`, never inline

## Modularity Practices
- Supabase access centralized in `src/lib/supabase/`:
  - `server.ts` — user-context client bound to `cookies()` (RLS applies)
  - `admin.ts` — service_role client (privileged, no cookie binding) — server-only
  - `middleware.ts` — proxy-context client bound to `NextRequest`/`NextResponse` for session refresh
- Route handlers under `src/app/api/` keep validation + response logic inline (no service layer abstracted yet)

## Data Architecture
- Postgres via Supabase. Schema managed by SQL migrations under `supabase/migrations/`.
- `profiles` table: id → auth.users.id, nickname, role (default `user`), created_at, updated_at.
- RLS policies restrict each user to their own row; `updated_at` maintained by DB trigger.
- Profile auto-created on signup via `on_auth_user_created` trigger (SECURITY DEFINER, search_path locked, idempotent).
- Connection via env vars only — never hardcode. Pooled connection string for serverless.

## Cross-Cutting Concerns
- Auth: Supabase Auth, wrapped by our own API routes. Email confirmation enabled (no auto-login on register). Session in httpOnly cookies via `@supabase/ssr`.
- Auth gate: `src/proxy.ts` protects all `/api/*` by default (fail-closed), with an explicit public allowlist (`/api/auth/register|login|confirm|logout|resend`); unauthenticated non-allowlisted requests return 401 JSON. Route handlers also keep their own `getUser()` check (defense in depth).
- Page route protection (also `src/proxy.ts`): unauthenticated visits to protected pages (`/profile`) redirect to `/login`; logged-in visits to auth pages (`/login`, `/register`) redirect home. Redirect targets are fixed constants (no open redirect). `config.matcher` is a static literal array (Next.js analyzes it at build time — variables are silently ignored) kept in sync by comment with the `PROTECTED_PAGES`/`AUTH_PAGES` runtime constants; new protected/auth pages need both updated, new API routes only need the whitelist (the `/api/:path*` matcher already covers them).
- Anti-enumeration: register/login/resend all return identical status codes and generic messages regardless of whether an account exists, is verified, or is rate-limited — status code parity is checked explicitly (not just message text), since a prior bug (task 2) leaked account existence via a differing status code alone.
- Error handling: API routes return explicit 400/401/403/404/500 with generic messages; avoid leaking account existence (anti-enumeration).
- Logging: never log tokens/session/cookies/passwords.

## Service Communication
Next.js API routes (backend logic co-located with frontend). Implemented: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/confirm`, `/api/auth/resend`, `/api/profile` (GET/PATCH). Protected by `src/proxy.ts`.

## Test Coverage
- Overall coverage: manual + Playwright E2E only (no unit/integration test framework or Docker installed).
- Backend testing approach: manual verification via checklists (`supabase/tests/auth_routes_manual.md`) + Insomnia collection (`supabase/tests/insomnia_auth.json`) + SQL verify scripts.
- Frontend testing approach: Playwright (`playwright-tests/`, page-object pattern) is the acceptance gate for FRONTEND tasks — runs against a live dev server + the real cloud Supabase project (test accounts in `.env.playwright.local`, gitignored).
- Key untested areas (automated unit/integration level): all API routes and proxy — covered only by manual checklists; Playwright covers only user-facing browser flows, not isolated unit behavior.
- Frontend: fully implemented (register/login/profile pages, route protection, resend-verification flow with cooldown) — membership-system story complete (9/9 tasks).

## Entry Points
- `src/app/layout.tsx` — root layout
- `src/app/page.tsx` — home page
- `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/profile/page.tsx` — auth/profile pages
- `src/proxy.ts` — root proxy (API auth gate + page route protection + session refresh)
- `next.config.ts` — Next.js config
- `playwright.config.ts` — Playwright E2E config
- `supabase/config.toml` — Supabase CLI config (email confirmations enabled, resend `max_frequency` 60s locally — cloud project's rate limit is set separately in the Supabase Dashboard, not by this file)
- `.env.local` — local env (gitignored) / `.env.example` — env var template
- Vercel deployment: env vars must be set per-environment in the Vercel dashboard (Production/Preview/Development are separate scopes — Development has no deployed domain, it's only for `vercel dev`); changing them requires a manual Redeploy.

## Changed Files (last delta — membership tasks 5-9, story complete)
- src/app/login/page.tsx, src/app/register/page.tsx, src/app/profile/page.tsx, src/app/page.tsx, src/app/layout.tsx
- src/components/AuthNav.tsx
- src/lib/auth-client.ts, src/lib/profile-client.ts, src/lib/validation.ts, src/lib/resend-cooldown.ts
- src/app/api/auth/resend/route.ts
- src/proxy.ts (page route protection + resend whitelist)
- playwright-tests/*, playwright.config.ts (new)
- supabase/config.toml, supabase/tests/auth_routes_manual.md, supabase/tests/insomnia_auth.json

## Last Scanned
2026-07-11T22:05:00+08:00
