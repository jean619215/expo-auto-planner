-- Manual verification script for the `profiles` migration.
--
-- This project has no Docker available, so this is NOT an automated pgTAP
-- test suite. Copy/paste each query below into the Supabase Dashboard
-- (Project → SQL Editor) AFTER applying the migration
-- (supabase/migrations/20260708173519_create_profiles.sql), run it, and
-- compare the result against the "Expected" comment above each query.
--
-- Do not run this file with `supabase db push` / `db reset` — it is a
-- read-only checklist, not a migration.

-- ============================================================
-- 1. Table + columns exist with the right shape
-- ============================================================
-- Expected: exactly 5 rows —
--   id          | uuid        | NO  | NULL
--   nickname    | text        | YES | NULL
--   role        | text        | NO  | 'user'::text
--   created_at  | timestamptz | NO  | now()
--   updated_at  | timestamptz | NO  | now()
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
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
  and tc.table_name = 'profiles'
  and tc.constraint_type = 'PRIMARY KEY';

-- ============================================================
-- 3. `id` has a FK to auth.users(id) with ON DELETE CASCADE
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
  and tc.table_name = 'profiles'
  and tc.constraint_type = 'FOREIGN KEY';

-- ============================================================
-- 4. `role` defaults to 'user' when not specified (behavioural check)
-- ============================================================
-- Run this only against a throwaway/dev auth.users row (id must exist in
-- auth.users first because of the FK). Expected: role = 'user'.
-- Example (replace <existing-auth-user-uuid> with a real id from auth.users):
--
-- insert into public.profiles (id) values ('<existing-auth-user-uuid>');
-- select role from public.profiles where id = '<existing-auth-user-uuid>';
-- -- Expected: 'user'
--
-- cleanup: delete from public.profiles where id = '<existing-auth-user-uuid>';

-- ============================================================
-- 5. RLS is enabled on profiles
-- ============================================================
-- Expected: relrowsecurity = t
select relrowsecurity
from pg_class
where oid = 'public.profiles'::regclass;

-- ============================================================
-- 6. Exactly 3 policies exist (select/update/insert, no delete)
-- ============================================================
-- Expected: 3 rows —
--   profiles_select_own | SELECT
--   profiles_update_own | UPDATE
--   profiles_insert_own | INSERT
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by policyname;

-- ============================================================
-- 7. updated_at trigger exists
-- ============================================================
-- Expected: one row, trigger_name = 'profiles_set_updated_at'
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'profiles';

-- ============================================================
-- 8. Cascade delete behaviour (edge case, dev-only, destructive)
-- ============================================================
-- Only run against a disposable test user. Expected: deleting the
-- auth.users row also removes the matching profiles row (0 rows left).
--
-- delete from auth.users where id = '<existing-auth-user-uuid>';
-- select * from public.profiles where id = '<existing-auth-user-uuid>';
-- -- Expected: 0 rows

-- ============================================================
-- 9. RLS isolation — runnable manual check (dev-only, destructive)
-- ============================================================
-- Simulates two authenticated users by setting the role + JWT claims that
-- Supabase's auth.uid() reads. Run the whole block in the SQL Editor.
-- Requires two real ids that exist in auth.users (FK). Replace the two
-- UUIDs below with disposable dev users.
--
-- Expected results are noted inline. If any "Expected" is violated, RLS
-- is NOT isolating correctly — treat as a failure.
--
-- do $$
-- begin
--   -- seed (bypasses RLS because this runs as the table owner)
--   insert into public.profiles (id, nickname) values
--     ('<userA-uuid>', 'A'), ('<userB-uuid>', 'B')
--   on conflict (id) do nothing;
-- end $$;
--
-- -- Act as user A:
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<userA-uuid>","role":"authenticated"}';
--
-- select id, nickname from public.profiles;
-- -- Expected: only user A's row (1 row). User B's row must NOT appear.
--
-- update public.profiles set nickname = 'hacked' where id = '<userB-uuid>';
-- -- Expected: 0 rows affected (cannot modify another user's row).
--
-- reset role;
-- -- cleanup:
-- delete from public.profiles where id in ('<userA-uuid>','<userB-uuid>');
