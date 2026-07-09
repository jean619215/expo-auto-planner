# Project Documentation
> Generated: 2026-07-08 | Mode: FULL | Last delta: 2026-07-09 (membership tasks 1-4)

## Tech Stack
- Runtime: Node.js 22.21.1 (pinned in `.nvmrc`)
- Language: TypeScript (strict mode)
- Framework: Next.js 16.2.10 (App Router) — **non-standard version, breaking changes from training data. Consult `node_modules/next/dist/docs/` before writing framework-specific code.**
- Database: Postgres via Supabase (Auth + Postgres). Server-side access only, through our own Next.js API routes.
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`)
- State Management: none yet (no state library installed)

## Dependencies
- Core: next@16.2.10, react@19.2.4, react-dom@19.2.4, @supabase/supabase-js@^2.109.0, @supabase/ssr@^0.12.0
- Dev: typescript@5, eslint@9, eslint-config-next@16.2.10, tailwindcss@4, supabase@^2.109.1 (CLI), @types/node, @types/react, @types/react-dom

## Architecture Pattern
Next.js App Router with backend logic co-located in API route handlers. Supabase is infrastructure only (Auth + Postgres) — the frontend never calls the Supabase client directly; all access flows through our own `/api/*` routes, which use the Supabase server-side SDK. RLS is a second line of defense, not the sole guard.

## Folder Structure
```
src/app/           — App Router routes (default layout.tsx + page.tsx)
src/app/api/       — API route handlers (auth/*, profile)
src/lib/supabase/  — Supabase client factories (server.ts, admin.ts) + proxy helper (middleware.ts)
src/proxy.ts       — Next.js 16 root proxy (formerly middleware.ts): API auth gate + session refresh
supabase/          — CLI project: migrations, config.toml, tests (manual checklists, insomnia collection)
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
- Auth gate: `src/proxy.ts` protects all `/api/*` by default (fail-closed), with an explicit public allowlist (`/api/auth/register|login|confirm|logout`); unauthenticated non-allowlisted requests return 401 JSON. Route handlers also keep their own `getUser()` check (defense in depth).
- Error handling: API routes return explicit 400/401/403/404/500 with generic messages; avoid leaking account existence (anti-enumeration).
- Logging: never log tokens/session/cookies/passwords.

## Service Communication
Next.js API routes (backend logic co-located with frontend). Implemented: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/confirm`, `/api/profile` (GET/PATCH). Protected by `src/proxy.ts`.

## Test Coverage
- Overall coverage: 0% automated (no JS test framework / Docker installed).
- Testing approach: manual verification via checklists (`supabase/tests/auth_routes_manual.md`) + Insomnia collection (`supabase/tests/insomnia_auth.json`) + SQL verify scripts.
- Key untested areas (automated): all API routes and proxy — covered only by manual checklists.
- Frontend: not yet implemented (tasks 5-7 pending).

## Entry Points
- `src/app/layout.tsx` — root layout
- `src/app/page.tsx` — home page
- `src/proxy.ts` — root proxy (API auth gate + session refresh)
- `next.config.ts` — Next.js config
- `supabase/config.toml` — Supabase CLI config (email confirmations enabled)
- `.env.local` — local env (gitignored) / `.env.example` — env var template

## Changed Files (last delta — membership tasks 1-4)
- src/app/api/auth/* , src/app/api/profile/route.ts
- src/lib/supabase/server.ts, admin.ts, middleware.ts
- src/proxy.ts
- supabase/migrations/*, supabase/config.toml, supabase/tests/*

## Last Scanned
2026-07-09T09:18:00Z
