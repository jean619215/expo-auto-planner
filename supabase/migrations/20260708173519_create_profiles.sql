-- Create profiles table (1:1 with auth.users) + RLS policies + updated_at trigger

create table public.profiles (
  id         uuid        primary key
                         references auth.users (id) on delete cascade,
  nickname   text,
  role       text        not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is '會員 profile，1:1 對應 auth.users';
comment on column public.profiles.role is 'user（預設）/ 未來可擴充 curator 等';

alter table public.profiles enable row level security;

-- 讓 authenticated 角色能存取此表（RLS policy 才會實際生效；新版 Supabase 預設新表不自動 expose）。
-- 這是第二道防線：一般存取走 API route 的 secret key（bypass RLS），此 grant 確保帶使用者 JWT 直連時 policy 仍能作用。
grant select, insert, update on public.profiles to authenticated;

-- SELECT：只能讀自己的 row
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ( (select auth.uid()) = id );

-- UPDATE：只能改自己的 row（using 檢查舊列、with check 檢查新列）
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- INSERT：只能插入 id = 自己 uid 的 row
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ( (select auth.uid()) = id );

-- 不建立 DELETE policy：帳號刪除不在本 task 範圍（RLS 預設 deny）。

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();
