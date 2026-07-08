# Project Documentation
> Generated: 2026-07-08 | Mode: FULL

## Tech Stack
- Runtime: Node.js 22.21.1 (pinned in `.nvmrc`)
- Language: TypeScript (strict mode)
- Framework: Next.js 16.2.10 (App Router) — **non-standard version, breaking changes from training data. Consult `node_modules/next/dist/docs/` before writing framework-specific code.**
- Database: none yet — spec decides Postgres via Neon or Supabase (not Vercel Postgres), connected via `DATABASE_URL` env var
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`)
- State Management: none yet (no state library installed)

## Dependencies
- Core: next@16.2.10, react@19.2.4, react-dom@19.2.4
- Dev: typescript@5, eslint@9, eslint-config-next@16.2.10, tailwindcss@4, @types/node, @types/react, @types/react-dom

## Architecture Pattern
Fresh `create-next-app` scaffold. No custom architecture established yet — only default App Router structure exists.

## Folder Structure
```
src/app/       — App Router routes (currently only default layout.tsx + page.tsx)
public/        — static assets
specs/         — project spec docs (OVERVIEW.md: tech decisions, open questions)
stories/       — ship-mate pipeline story files
.claude/       — Claude Code config, agents, pipeline state
```

## Code Style Conventions
- Path alias `@/*` → `./src/*`
- ESLint via `eslint-config-next` (core-web-vitals + typescript)
- No custom naming conventions established yet (project too early-stage)

## Modularity Practices
Not yet established — no services/lib/components layers exist yet.

## Data Architecture
No ORM or DB client installed yet. Spec (`specs/OVERVIEW.md`) mandates:
- Postgres via Neon or Supabase, not Vercel's managed Postgres product
- Serverless functions must use pooled connection strings (`-pooler`)
- Connection via `DATABASE_URL` env var, kept decoupled from deploy platform

## Cross-Cutting Concerns
- Auth: undecided (open question in spec — may use Supabase Auth or Auth.js/NextAuth)
- Error handling / logging / validation: not yet established

## Service Communication
Next.js API routes (backend logic co-located with frontend, per spec decision). No routes implemented yet.

## Test Coverage
- Overall coverage: 0% (no tests exist yet)
- Testing framework: none installed yet
- Key untested areas: entire codebase (pre-feature-development stage)
- Test patterns used: none yet

## Entry Points
- `src/app/layout.tsx` — root layout
- `src/app/page.tsx` — home page
- `next.config.ts` — Next.js config (currently empty/default)
- `.env.local` — local DB connection string (gitignored)
- `.env.example` — env var template

## Last Scanned
2026-07-08T00:00:00Z
