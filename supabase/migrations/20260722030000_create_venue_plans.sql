-- 場地儲存檔:每人 3 格 (slot 1–3),一格 = 一份配置 jsonb 快照 + 名稱。
--
-- 設計原則(比照 point_transactions 慣例):
-- * 三格上限由 DB 硬保證:check (slot between 1 and 3) + unique (user_id, slot),
--   非應用層計數;未來「點數解鎖更多格」只需放寬 check。
-- * 寫入僅 service_role(API route 內 admin client);authenticated 只能讀自己的。
--   明確 revoke insert/update/delete — Supabase default privileges 對新表會
--   grant anon/authenticated 完整 CRUD(20260717010000 踩過的坑),不依賴預設。
-- * updated_at 由 DB trigger 維護,沿用 profiles 的 public.set_updated_at()。

create table public.venue_plans (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  slot        smallint    not null check (slot between 1 and 3),
  name        text        not null default '未命名場地',
  plan        jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, slot)
);

comment on table public.venue_plans is '場地儲存檔:每人 3 格,plan 為 polygon/walls/columns/furniture 整包快照';
comment on column public.venue_plans.slot is '格位 1–3,unique(user_id, slot) + check 硬保證上限';

create index venue_plans_user_id_idx on public.venue_plans (user_id);

alter table public.venue_plans enable row level security;

-- 只開放讀自己的;寫入僅 service_role(bypass RLS)。
grant select on public.venue_plans to authenticated;

create policy "venue_plans_select_own"
  on public.venue_plans
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- grant 層 + RLS 雙層防禦:明確拔掉 default privileges 給的寫入權。
revoke insert, update, delete on public.venue_plans from anon, authenticated;

-- updated_at trigger:重用 20260708173519 建立的 public.set_updated_at()
-- (該 function 已存在於 DB,不重複定義)。
create trigger venue_plans_set_updated_at
  before update on public.venue_plans
  for each row
  execute function public.set_updated_at();
