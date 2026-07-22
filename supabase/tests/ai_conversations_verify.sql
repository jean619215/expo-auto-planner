-- Manual verification script for the `ai_conversations` / `ai_messages` migration.
--
-- This project has no Docker available, so this is NOT an automated pgTAP
-- test suite. Copy/paste each query below into the Supabase Dashboard
-- (Project → SQL Editor) AFTER applying the migration
-- (supabase/migrations/20260722080000_create_ai_conversations.sql), run it,
-- and compare the result against the "Expected" comment above each query.
--
-- Do not run this file with `supabase db push` / `db reset` — it is a
-- read-only checklist, not a migration.

-- ============================================================
-- 1. ai_conversations: columns exist with the right shape
-- ============================================================
-- Expected: exactly 4 rows —
--   id          | uuid        | NO  | gen_random_uuid()
--   plan_id     | uuid        | NO  | NULL
--   created_at  | timestamptz | NO  | now()
--   updated_at  | timestamptz | NO  | now()
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_conversations'
order by ordinal_position;

-- ============================================================
-- 2. ai_messages: columns exist with the right shape
-- ============================================================
-- Expected: exactly 5 rows —
--   id               | bigint      | NO  | (identity, no literal default)
--   conversation_id  | uuid        | NO  | NULL
--   role             | text        | NO  | NULL
--   content          | jsonb       | NO  | NULL
--   created_at       | timestamptz | NO  | now()
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_messages'
order by ordinal_position;

-- ============================================================
-- 3. ai_messages.id is a bigint identity column
-- ============================================================
-- Expected: is_identity = 'YES', identity_generation = 'ALWAYS'
select column_name, is_identity, identity_generation
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_messages' and column_name = 'id';

-- ============================================================
-- 4. Primary keys
-- ============================================================
-- Expected: two rows — ai_conversations.id, ai_messages.id
select tc.table_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.table_name in ('ai_conversations', 'ai_messages')
  and tc.constraint_type = 'PRIMARY KEY'
order by tc.table_name;

-- ============================================================
-- 5. FK cascade — ai_conversations.plan_id -> venue_plans(id)
-- ============================================================
-- Expected: one row referencing venue_plans, delete_rule = 'CASCADE'
select
  tc.constraint_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'ai_conversations'
  and tc.constraint_type = 'FOREIGN KEY';

-- ============================================================
-- 6. FK cascade — ai_messages.conversation_id -> ai_conversations(id)
-- ============================================================
-- Expected: one row referencing ai_conversations, delete_rule = 'CASCADE'
select
  tc.constraint_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'ai_messages'
  and tc.constraint_type = 'FOREIGN KEY';

-- ============================================================
-- 7. ai_conversations.plan_id is unique (1:1 with venue_plans)
-- ============================================================
-- Expected: one row, constraint_type = 'UNIQUE', column_name = 'plan_id'
select tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'ai_conversations'
  and tc.constraint_type = 'UNIQUE';

-- ============================================================
-- 8. ai_messages.role check constraint
-- ============================================================
-- Expected: one row, definition mentions role = ANY (ARRAY['user', 'assistant'])
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.ai_messages'::regclass
  and contype = 'c';

-- ============================================================
-- 9. ai_messages_conversation_id_id_idx index exists
-- ============================================================
-- Expected: one row, indexname = 'ai_messages_conversation_id_id_idx'
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'ai_messages'
  and indexname = 'ai_messages_conversation_id_id_idx';

-- ============================================================
-- 10. RLS is enabled on both tables
-- ============================================================
-- Expected: two rows, both relrowsecurity = t
select relname, relrowsecurity
from pg_class
where oid in ('public.ai_conversations'::regclass, 'public.ai_messages'::regclass);

-- ============================================================
-- 11. Exactly 1 select-own policy per table (no insert/update/delete policy)
-- ============================================================
-- Expected: two rows —
--   ai_conversations_select_own | SELECT
--   ai_messages_select_own      | SELECT
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('ai_conversations', 'ai_messages')
order by tablename, policyname;

-- ============================================================
-- 12. Grant/revoke: authenticated has SELECT only, anon has nothing
-- ============================================================
-- Expected: authenticated → exactly one SELECT row per table.
-- anon → 0 rows (no grants at all) for both tables.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('ai_conversations', 'ai_messages')
  and grantee in ('authenticated', 'anon')
order by table_name, grantee, privilege_type;

-- ============================================================
-- 13. Sequence: no grants to anon/authenticated on ai_messages_id_seq
-- ============================================================
-- Expected: 0 rows (confirm actual sequence name first if this differs —
-- \d public.ai_messages or pg_get_serial_sequence('public.ai_messages','id')).
select grantee, privilege_type
from information_schema.role_usage_grants
where object_schema = 'public'
  and object_name = 'ai_messages_id_seq'
  and grantee in ('authenticated', 'anon');

-- ============================================================
-- 14. updated_at trigger exists and is bound to set_updated_at()
-- ============================================================
-- Expected: one row, trigger_name = 'ai_conversations_set_updated_at',
-- event_manipulation = 'UPDATE', action_timing = 'BEFORE'
select trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'ai_conversations';

-- ============================================================
-- 15. authenticated role cannot insert/update/delete (dev-only, destructive)
-- ============================================================
-- Run in the SQL Editor as a non-superuser session. Requires a real
-- venue_plans.id to exist (FK). Replace the UUIDs below with disposable
-- dev data. Expected: every statement raises "permission denied for
-- table ai_conversations"/"ai_messages" (revoke) — not merely "0 rows"
-- from an RLS filter.
--
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<some-uuid>","role":"authenticated"}';
--
-- insert into public.ai_conversations (plan_id) values ('<existing-venue-plans-id>');
-- -- Expected: permission denied for table ai_conversations
--
-- update public.ai_conversations set updated_at = now() where plan_id = '<existing-venue-plans-id>';
-- -- Expected: permission denied for table ai_conversations
--
-- delete from public.ai_conversations where plan_id = '<existing-venue-plans-id>';
-- -- Expected: permission denied for table ai_conversations
--
-- insert into public.ai_messages (conversation_id, role, content)
--   values ('<existing-ai_conversations-id>', 'assistant', '[{"type":"text","text":"x"}]');
-- -- Expected: permission denied for table ai_messages
--
-- reset role;

-- ============================================================
-- 16. RLS isolation — runnable manual check (dev-only, destructive)
-- ============================================================
-- Simulates two authenticated users, each owning one venue_plans row with
-- a conversation. Requires two real venue_plans rows owned by different
-- users. Replace the UUIDs below with disposable dev data.
--
-- do $$
-- begin
--   insert into public.ai_conversations (plan_id) values ('<userA-venue-plans-id>')
--   on conflict (plan_id) do nothing;
-- end $$;
--
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<userB-uuid>","role":"authenticated"}';
--
-- select * from public.ai_conversations where plan_id = '<userA-venue-plans-id>';
-- -- Expected: 0 rows (user B must not see user A's conversation via join policy)
--
-- reset role;
-- -- cleanup:
-- delete from public.ai_conversations where plan_id = '<userA-venue-plans-id>';

-- ============================================================
-- 17. Cascade delete behaviour (edge case, dev-only, destructive)
-- ============================================================
-- Only run against a disposable test venue_plans row with a conversation +
-- messages already seeded. Expected: deleting the venue_plans row also
-- removes the matching ai_conversations row and, transitively, all its
-- ai_messages rows (0 rows left in both).
--
-- delete from public.venue_plans where id = '<existing-venue-plans-id>';
-- select * from public.ai_conversations where plan_id = '<existing-venue-plans-id>';
-- -- Expected: 0 rows
-- select * from public.ai_messages where conversation_id = '<the-deleted-conversation-id>';
-- -- Expected: 0 rows
