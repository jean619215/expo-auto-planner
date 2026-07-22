-- Manual verification script for the `venue_plans` migration.
--
-- This project has no Docker available, so this is NOT an automated pgTAP
-- test suite. Copy/paste each query below into the Supabase Dashboard
-- (Project → SQL Editor) AFTER applying the migration
-- (supabase/migrations/20260722030000_create_venue_plans.sql), run it, and
-- compare the result against the "Expected" comment above each query.
--
-- Do not run this file with `supabase db push` / `db reset` — it is a
-- read-only checklist, not a migration.

-- ============================================================
-- 1. Table + columns exist with the right shape
-- ============================================================
-- Expected: exactly 7 rows —
--   id          | uuid        | NO  | gen_random_uuid()
--   user_id     | uuid        | NO  | NULL
--   slot        | smallint    | NO  | NULL
--   name        | text        | NO  | '未命名場地'::text
--   plan        | jsonb       | NO  | NULL
--   created_at  | timestamptz | NO  | now()
--   updated_at  | timestamptz | NO  | now()
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'venue_plans'
order by ordinal_position;

-- ============================================================
-- 2. `id` is the primary key
-- ============================================================
-- Expected: one row, constraint_type = 'PRIMARY KEY', column_name = 'id'
select tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'venue_plans'
  and tc.constraint_type = 'PRIMARY KEY';

-- ============================================================
-- 3. `user_id` has a FK to auth.users(id) with ON DELETE CASCADE
-- ============================================================
-- Expected: one row referencing auth.users, delete_rule = 'CASCADE'
select
  tc.constraint_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'venue_plans'
  and tc.constraint_type = 'FOREIGN KEY';

-- ============================================================
-- 4. `check (slot between 1 and 3)` constraint exists
-- ============================================================
-- Expected: one row, check_clause mentions slot >= 1 and slot <= 3
-- (Postgres normalizes "between" into >= / <= in pg_constraint's expression)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.venue_plans'::regclass
  and contype = 'c';

-- ============================================================
-- 5. `unique (user_id, slot)` constraint exists
-- ============================================================
-- Expected: one row, constraint_type = 'UNIQUE', columns = user_id, slot
select tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'venue_plans'
  and tc.constraint_type = 'UNIQUE'
order by kcu.ordinal_position;

-- ============================================================
-- 6. `venue_plans_user_id_idx` index exists
-- ============================================================
-- Expected: one row, indexname = 'venue_plans_user_id_idx'
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'venue_plans';

-- ============================================================
-- 7. RLS is enabled on venue_plans
-- ============================================================
-- Expected: relrowsecurity = t
select relrowsecurity
from pg_class
where oid = 'public.venue_plans'::regclass;

-- ============================================================
-- 8. Exactly 1 policy exists (select-own, no insert/update/delete policy)
-- ============================================================
-- Expected: 1 row — venue_plans_select_own | SELECT
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'venue_plans'
order by policyname;

-- ============================================================
-- 9. Grant/revoke: authenticated has SELECT only, anon has nothing
-- ============================================================
-- Expected: authenticated → exactly one row, privilege_type = 'SELECT'.
-- anon → 0 rows (no grants at all).
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'venue_plans'
  and grantee in ('authenticated', 'anon')
order by grantee, privilege_type;

-- ============================================================
-- 10. updated_at trigger exists and is bound to set_updated_at()
-- ============================================================
-- Expected: one row, trigger_name = 'venue_plans_set_updated_at',
-- event_manipulation = 'UPDATE', action_timing = 'BEFORE'
select trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'venue_plans';

-- ============================================================
-- 11. authenticated role cannot insert/update/delete (dev-only, destructive)
-- ============================================================
-- Run in the SQL Editor as a non-superuser session. Requires a real id that
-- exists in auth.users (FK). Replace the UUID below with a disposable dev
-- user. Expected: every statement raises "permission denied for table
-- venue_plans" (revoke) — not merely "0 rows" from an RLS filter.
--
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<some-uuid>","role":"authenticated"}';
--
-- insert into public.venue_plans (user_id, slot, plan)
--   values ('<some-uuid>', 1, '{"polygon":[],"walls":[],"columns":[],"furniture":[]}');
-- -- Expected: permission denied for table venue_plans
--
-- update public.venue_plans set name = 'x' where slot = 1;
-- -- Expected: permission denied for table venue_plans
--
-- delete from public.venue_plans where slot = 1;
-- -- Expected: permission denied for table venue_plans
--
-- reset role;

-- ============================================================
-- 12. RLS isolation — runnable manual check (dev-only, destructive)
-- ============================================================
-- Simulates two authenticated users. Requires two real ids that exist in
-- auth.users (FK). Replace the UUIDs below with disposable dev users.
--
-- do $$
-- begin
--   -- seed (bypasses RLS because this runs as the table owner)
--   insert into public.venue_plans (user_id, slot, plan) values
--     ('<userA-uuid>', 1, '{"polygon":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}],"walls":[],"columns":[],"furniture":[]}')
--   on conflict (user_id, slot) do nothing;
-- end $$;
--
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<userB-uuid>","role":"authenticated"}';
--
-- select slot, name from public.venue_plans;
-- -- Expected: 0 rows (user B has no saves; user A's row must NOT appear).
--
-- reset role;
-- -- cleanup:
-- delete from public.venue_plans where user_id = '<userA-uuid>';

-- ============================================================
-- 13. Cascade delete behaviour (edge case, dev-only, destructive)
-- ============================================================
-- Only run against a disposable test user. Expected: deleting the
-- auth.users row also removes the matching venue_plans row (0 rows left).
--
-- delete from auth.users where id = '<existing-auth-user-uuid>';
-- select * from public.venue_plans where user_id = '<existing-auth-user-uuid>';
-- -- Expected: 0 rows
