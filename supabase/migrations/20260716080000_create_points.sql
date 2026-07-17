-- 會員點數系統: append-only ledger + 購買訂單 + 註冊贈點 + 既有帳號 backfill
--
-- 設計原則:
-- * 餘額不設可變欄位,一律由 point_transactions 的 SUM(delta) 導出 — 可稽核、可對帳。
-- * 寫入只允許 service_role (API route 內的 admin client);authenticated 只能讀自己的。
-- * idempotency 由 ref_id 的 unique constraint 承擔:webhook 重送、註冊 trigger 重放
--   都會在 DB 層被擋下,應用層不需要自己做去重。

-- ── 點數帳本 ────────────────────────────────────────────────────────────────

create table public.point_transactions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  delta      integer     not null check (delta <> 0),
  reason     text        not null check (reason in ('signup_bonus', 'purchase')),
  ref_id     text        unique,
  created_at timestamptz not null default now()
);

comment on table public.point_transactions is '點數帳本 (append-only),餘額 = SUM(delta)';
comment on column public.point_transactions.ref_id is '冪等鍵:signup:{user_id} / order:{order_id},unique 擋重複發放';

create index point_transactions_user_id_idx on public.point_transactions (user_id);

alter table public.point_transactions enable row level security;

-- 只開放讀自己的;不 grant insert/update/delete — 寫入僅 service_role (bypass RLS)。
grant select on public.point_transactions to authenticated;

create policy "point_transactions_select_own"
  on public.point_transactions
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ── 購買訂單 ────────────────────────────────────────────────────────────────

create table public.point_orders (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  package_id       text        not null,
  amount_twd       integer     not null check (amount_twd > 0),
  points           integer     not null check (points > 0),
  status           text        not null default 'pending'
                               check (status in ('pending', 'paid', 'failed')),
  provider         text        not null check (provider in ('mock', 'ecpay')),
  provider_txn_id  text,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);

comment on table public.point_orders is '點數購買訂單;金額/點數在建單時定價快照,不回頭查 package 設定';

create index point_orders_user_id_idx on public.point_orders (user_id);

alter table public.point_orders enable row level security;

grant select on public.point_orders to authenticated;

create policy "point_orders_select_own"
  on public.point_orders
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ── 註冊贈 50 點 ─────────────────────────────────────────────────────────────
-- 沿用 profiles 的 DB trigger 模式:發放交給 DB 層,應用層不需記得呼叫。
-- ref_id = 'signup:{user_id}' 的 unique constraint 保證同一人永遠只發一次。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- 需以 owner 權限寫入 public schema(跨 schema、繞過 RLS)
set search_path = ''        -- 鎖死 search_path,防 search_path 注入
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;   -- 冪等,重放安全

  insert into public.point_transactions (user_id, delta, reason, ref_id)
  values (new.id, 50, 'signup_bonus', 'signup:' || new.id)
  on conflict (ref_id) do nothing;   -- 冪等,重放安全

  return new;
end;
$$;

-- ── Backfill:既有帳號補發 50 點 ─────────────────────────────────────────────
-- migration 本身只跑一次;ref_id unique + on conflict 讓它即使重跑也不會重複發。

insert into public.point_transactions (user_id, delta, reason, ref_id)
select u.id, 50, 'signup_bonus', 'signup:' || u.id
from auth.users u
on conflict (ref_id) do nothing;
