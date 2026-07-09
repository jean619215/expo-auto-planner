# Orchestrator Output — Task 1

> Story: 會員系統 | Task 1 of 7 | Type: BACKEND

## Task
[BACKEND] 建立 profiles 資料表 (id 對應 auth.users.id、暱稱、role 預設 user、建立時間),設定 RLS policy (使用者只能存取自己的 row)。

## Confirmed Decisions (from user)
1. **Migration mechanism**: Supabase CLI migration files (`supabase/migrations/*.sql`), version-controlled, applied via `supabase db push`. **No ORM** (no Drizzle/Prisma).
2. **Supabase project**: already created by user; env vars already filled in `.env.local`. This task does NOT create the cloud project — it only produces the schema/RLS migration and verifies it applies.

## Scope (this task only)
- Add Supabase CLI as a dev dependency + init `supabase/` local config.
- Write a migration that creates the `profiles` table.
- Write RLS policies on `profiles`.
- Do NOT build API routes, auth endpoints, or frontend — those are later tasks.

## profiles Table Design
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `nickname` | `text` | nullable |
| `role` | `text` | NOT NULL, default `'user'` (future: `curator` etc.) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

Extensibility note (per story): keep design open for adding columns (preferences etc.) without restructuring. `user_id` naming convention on future tables/storage paths will reference `profiles.id` / `auth.users.id`.

## RLS Policies (on profiles)
- Enable RLS on the table.
- `SELECT`: a user can read only the row where `id = auth.uid()`.
- `UPDATE`: a user can update only the row where `id = auth.uid()`.
- `INSERT`: allow insert only where `id = auth.uid()` (profile creation is normally done server-side via secret key which bypasses RLS, but keep the policy correct as the second line of defense).
- No `DELETE` policy for now (account deletion is out of scope).

## Acceptance Criteria (this task)
- Migration file exists under `supabase/migrations/` and is valid SQL.
- Applying the migration creates `profiles` with the columns above.
- RLS is enabled; with an authenticated user context, queries only return/modify that user's own row.
- Migration is idempotent-safe to the extent Supabase CLI expects (forward migration only).

## Edge Cases / Notes for QA
- Deleting an `auth.users` row cascades and removes the matching `profiles` row.
- `role` always defaults to `'user'` when not specified.
- RLS must be verifiable: an authenticated user cannot SELECT another user's profile row.

## Out of Scope
- Auto-creating a profile on signup (that's Task 2's `/api/auth/register`).
- Any API route or UI.
