-- AI 對話持久化:一格存檔 (venue_plans) 1:1 一段對話 (ai_conversations),
-- 訊息 (ai_messages) 以 identity bigint 為插入序即顯示序。
--
-- 設計原則(比照 venue_plans / point_transactions 慣例):
-- * plan_id unique FK + on delete cascade:刪存檔帶走整段對話;未來要 1:N
--   只需拔 unique constraint,不動表結構。
-- * 兩表皆不存 user_id — 所有權單一事實來源在 venue_plans.user_id,
--   RLS select-own 逐層 join 驗證(RLS 是第二道防線;實際讀寫走 API 層
--   admin client + 應用層過濾)。
-- * 寫入僅 service_role(API route 內 admin client);authenticated 只能讀
--   自己的。明確 revoke insert/update/delete — Supabase default privileges
--   對新表會 grant anon/authenticated 完整 CRUD(20260717010000 踩過的坑),
--   不依賴預設。此 revoke 是「防前端直寫 ai_messages 偽造 assistant 訊息」
--   的技術落地,不只是慣例延續。
-- * content 存 Anthropic API 原生 content blocks(jsonb),讀出直接塞回前端
--   state 續聊,零轉換;圖片 block 已於 API 層落庫前換成佔位符文字 block,
--   不存 base64。
-- * ai_conversations.updated_at 由 DB trigger 維護,沿用 public.set_updated_at()。

create table public.ai_conversations (
  id          uuid        primary key default gen_random_uuid(),
  plan_id     uuid        not null unique references public.venue_plans (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.ai_conversations is
  'AI 對話:與 venue_plans 1:1(plan_id unique FK cascade),刪存檔帶走對話';

create table public.ai_messages (
  id               bigint      generated always as identity primary key,
  conversation_id  uuid        not null references public.ai_conversations (id) on delete cascade,
  role             text        not null check (role in ('user', 'assistant')),
  content          jsonb       not null,
  created_at       timestamptz not null default now()
);

comment on table public.ai_messages is
  'AI 訊息:content 為 Anthropic 原生 content blocks(圖片已換佔位符);id 插入序即顯示序';

-- 讀檔查詢路徑:where conversation_id = ? order by id asc
create index ai_messages_conversation_id_id_idx
  on public.ai_messages (conversation_id, id);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- 只開放讀自己的;寫入僅 service_role(bypass RLS)。
grant select on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;

create policy "ai_conversations_select_own"
  on public.ai_conversations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.venue_plans vp
      where vp.id = ai_conversations.plan_id
        and vp.user_id = (select auth.uid())
    )
  );

create policy "ai_messages_select_own"
  on public.ai_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ai_conversations c
      join public.venue_plans vp on vp.id = c.plan_id
      where c.id = ai_messages.conversation_id
        and vp.user_id = (select auth.uid())
    )
  );

-- grant 層 + RLS 雙層防禦:明確拔掉 default privileges 給的寫入權。
revoke insert, update, delete on public.ai_conversations from anon, authenticated;
revoke insert, update, delete on public.ai_messages from anon, authenticated;

-- identity 欄位的 backing sequence 也拔掉(anon/authenticated 本就不該碰;
-- default privileges 對新 sequence 一樣會 grant)。
revoke usage, select, update on sequence public.ai_messages_id_seq from anon, authenticated;

-- updated_at trigger:重用 20260708173519 建立的 public.set_updated_at()
-- (該 function 已存在於 DB,不重複定義)。
create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row
  execute function public.set_updated_at();
