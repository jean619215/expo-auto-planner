# Architect Plan — ai_conversations/ai_messages migration + /api/ai/chat 對話落庫

> Story: 場地儲存檔與 AI 對話持久化 | Task type: BACKEND | Generated: 2026-07-22T14:30:00+08:00

## Overview

新增兩張對話表(單一 migration:`ai_conversations` 1:1 掛 `venue_plans`、`ai_messages` identity bigint 序),`POST /api/ai/chat` 增收可選 `planId`(auth → 格式 400 → 所有權 404 → 扣點 → 模型 → try/catch 落庫,失敗僅 log),`GET /api/plans/[slot]` 的 `conversation: []` 佔位換成真查詢。寫入僅 service_role(migration 明確 revoke),防前端偽造 assistant 訊息。

## Task Type Confirmed

BACKEND — 無 UI 變更、無 Playwright 新 spec(僅跑既有全套迴歸確認不退化)。與 orchestrator-output.md 一致,無矛盾。

## Escalation 檢查(先於計畫)

| 觸發條件 | 判定 |
| --- | --- |
| 外部 API contract 修改 | 否 — `/api/ai/chat` 僅**新增可選欄位** `planId`,不帶時行為與 response 形狀完全不變;`GET /api/plans/[slot]` 的 `conversation` 本來就宣告為佔位待換,另新增 `planId` 欄位為 additive(見 Architecture Notes 第 1 點,已標記) |
| DB schema 影響既有資料 | 否 — 純新增兩張表,零 ALTER 既有表、零資料搬移 |
| Auth/安全模型變更 | 否 — 沿用 proxy fail-closed(`/api/ai/chat` 已受保護,免改 allowlist)+ route 內 `getUser()`;RLS/revoke 慣例照抄 `venue_plans` |
| 複雜度超出 story 範圍 | 否 |
| 資訊不足 | 否 — orchestrator 已定案 schema 與流程順序 |

**結論:不需 escalation,繼續產出計畫。**

## Files to Create

| File path | Purpose |
| --- | --- |
| `supabase/migrations/20260722080000_create_ai_conversations.sql` | 兩表 + FK cascade + RLS select-own(join)+ grant/revoke + index + updated_at trigger(全文見下) |
| `supabase/tests/ai_conversations_verify.sql` | 比照 `venue_plans_verify.sql` 的唯讀 SQL 核對 checklist(結構/約束/RLS/policy/grant/trigger/cascade) |

## Files to Modify

| File path | What changes |
| --- | --- |
| `src/app/api/ai/chat/route.ts` | 增收可選 `planId`:uuid 格式驗證(400)、所有權驗證(404,先於扣點)、模型回應後 try/catch 增量落庫(module-private `persistConversation()`,失敗僅 `console.error`) |
| `src/app/api/plans/[slot]/route.ts` | GET:select 補 `id`,`conversation: []` 換兩段真查詢(conversation → messages 依 `id` 升冪),response 增列 `planId`;移除「task 2 換真查詢」過時註解 |
| `src/lib/ai-panel/messages.ts` | 僅改檔頭註解:標註 `PRIOR_IMAGE_PLACEHOLDER` 亦被 server route import,本模組必須維持 isomorphic(不得引入 server-only 或瀏覽器 API)——不改任何程式邏輯 |
| `supabase/tests/ai_chat_manual.md` | 追加「planId 落庫」驗證段落(案例見 Test Plan) |
| `supabase/tests/venue_plans_api_manual.md` | GET 讀檔段落更新:`conversation` 由固定 `[]` 改為「無對話回 `[]`/有對話回訊息陣列」+ 新增 `planId` 欄位斷言 |

## 關鍵設計決策

### 決策 1:RLS select-own 採 join,不 denormalize `user_id`

兩張新表**不存 `user_id` 欄位**,policy 逐層 join 回 `venue_plans.user_id`:

- 所有權單一事實來源在 `venue_plans`,denormalize 會引入資料漂移風險(存檔理論上不換主人,但多一份拷貝就多一個要守的 invariant),且 orchestrator Security Notes 已明確警告「這兩張表本身都不直接存 user_id」。
- 效能不是理由:實際讀取路徑走 API(admin client,bypass RLS,直接 `plan_id`/`conversation_id` 索引查詢);RLS 只是第二道防線(專案既定原則「RLS is a second line of defense」),join 成本僅發生在極少數直連情境,且 `plan_id` unique index + `ai_messages` 複合索引都在。

### 決策 2:佔位符常數 — server 直接 import client 純函式模組

`/api/ai/chat/route.ts` 直接 `import { PRIOR_IMAGE_PLACEHOLDER } from "@/lib/ai-panel/messages"`,不另建共用常數檔、不複製字串:

- **方向合法**:server-only 邊界是單向的——client 模組不得 import server-only 模組;反向(server import 無副作用的純模組)完全安全。`messages.ts` 檔頭已自我約束「不 import src/lib/ai/(server-only)或 admin.ts」,只依賴 `@anthropic-ai/sdk` 的 **type import**(編譯後歸零),是純 isomorphic 模組,不會把任何 client 專屬東西拖進 server bundle,也不會反向洩漏 key。
- **單一事實來源**:orchestrator 唯一硬性要求是兩處字串值完全相同——import 同一個 `export const` 讓「不同步」在結構上不可能發生,優於複製字串(靠人肉同步)與抽第三個常數檔(AGENTS.md:「do not invent premature patterns」;目前只有一個字串要共用,不值得為它開新模組)。
- **防退化**:在 `messages.ts` 檔頭註解補一句「本模組被 server route import,新增程式碼不得引入 server-only / 瀏覽器 API」,把約束留在最接近風險的位置。未來若共用面擴大(第二、三個常數出現),再抽 `src/lib/ai-shared/` 不遲。

### 決策 3:find-or-create 用 `upsert(onConflict: "plan_id", ignoreDuplicates: false)`

`ignoreDuplicates: false` 產生 `ON CONFLICT DO UPDATE`(set `plan_id = excluded.plan_id`,無害自賦值),**衝突時仍回傳既有列**,一次呼叫拿到 `conversation_id`,天然消解 race(orchestrator edge case);副作用是 DO UPDATE 觸發 `set_updated_at()`,`ai_conversations.updated_at` 恰好語意化為「最後對話時間」,是加分不是缺陷。若用 `ignoreDuplicates: true`(DO NOTHING),衝突時回傳空集合還得補一次 select,多一步且引入 TOCTOU 空窗。

### 決策 4:讀檔訊息形狀 `{ role, content }`,不帶 id/createdAt

依 orchestrator Assumption 3 精簡為兩欄:前端 state 零轉換直接續聊;不帶 `id` 就不存在 bigint→JS number 精度問題(PostgREST 對 bigint 預設序列化為 number,超過 2^53 會失真——不選字串序列化的麻煩,直接不帶)。排序由 SQL `order by id asc` 保證,前端渲染 key 用陣列 index 即可(唯讀歷史列表,不重排)。未來需要再加,additive 不破壞。

## Migration SQL 全文

`supabase/migrations/20260722080000_create_ai_conversations.sql`:

```sql
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
```

## Implementation Steps

1. **建立 migration** `supabase/migrations/20260722080000_create_ai_conversations.sql`,內容照上方全文(一字不差;若 push 時 sequence 名非 `ai_messages_id_seq` 再依實名修正——identity 預設命名即此,見 Verification 步驟 1 的先查後推)。

2. **修改 `src/app/api/ai/chat/route.ts` — planId 解析與驗證**(插在既有 messages 驗證之後、`deductPoints` 之前):
   - 新增常數 `PLAN_NOT_FOUND_ERROR = "找不到存檔"`(與 `/api/plans/[slot]` 的 `NOT_FOUND_ERROR` 字面一致)與 module-private `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`。
   - 從已 parse 的 `body` 取 `planId`:`undefined` 或 `null` → 視為未帶,走現況路徑(**零新增查詢**);其餘值必須是通過 `UUID_RE` 的 string,否則回 400 `INVALID_BODY_ERROR`(沿用既有常數,orchestrator AC 授權)。
   - `planId` 有效時,以 `createSupabaseAdminClient()`(新增 import `@/lib/supabase/admin`)查 `venue_plans`:`.select("id").eq("id", planId).eq("user_id", userId).maybeSingle()` — **`.eq("user_id", userId)` 為安全關鍵**(admin client 無 RLS,比照 plans route 既有註解慣例,不存在與非本人同樣回 404 不可區分)。查詢層錯誤(`error` 非 null)→ 500 `SERVER_ERROR`(此時尚未扣點,安全);無列 → 404 `{ error: PLAN_NOT_FOUND_ERROR }`。**此段必須在 `deductPoints` 呼叫之前**,確保 404 情境零扣點、零 `ai_usage` ledger 列。

3. **修改 `src/app/api/ai/chat/route.ts` — 落庫**(插在既有 `ai_usage` console.log 之後、`safeBalance`/return 之前):
   - 新增 import:`import { PRIOR_IMAGE_PLACEHOLDER } from "@/lib/ai-panel/messages";`(決策 2)。
   - `if (planId 有效) { try { await persistConversation(...) } catch (err) { console.error("POST /api/ai/chat 落庫失敗", JSON.stringify({ planId, refId, error: ... })) } }` — **catch 只 log,絕不改變 response**;log 不含訊息內容(避免對話內容進 log)。
   - module-private `persistConversation(admin, planId, lastUserMessage, assistantContent)`(route 檔內函式,不抽 service 層,遵循「validation + response logic inline」慣例):
     a. find-or-create:`admin.from("ai_conversations").upsert({ plan_id: planId }, { onConflict: "plan_id", ignoreDuplicates: false }).select("id").single()`(決策 3);`error` → throw(由外層 catch 統一 log)。
     b. user 訊息內容 = `messages[messages.length - 1]` 原樣(orchestrator Assumption 1;不驗 role,edge case 定案不擴大防禦),經 image→佔位符轉換:`content` 為陣列時逐 block map,`block.type === "image"` → `{ type: "text", text: PRIOR_IMAGE_PLACEHOLDER }`(**逐一替換不合併**,AC 明定),其餘 block(text/tool_result/未知型別)原樣保留;`content` 非陣列(理論不發生,Anthropic 允許 string)→ 原樣存,不轉換。
     c. 一次 `admin.from("ai_messages").insert([{ conversation_id, role: "user", content: 轉換後 }, { conversation_id, role: "assistant", content: response.content }])` — 同一條 INSERT 兩列,identity 依陣列順序遞增,user 必在 assistant 之前;assistant content 原樣(AC 明定不轉換)。`error` → throw。

4. **修改 `src/app/api/plans/[slot]/route.ts` — GET 真查詢**:
   - select 改為 `"id, slot, name, plan, updated_at"`。
   - plan 列查到後:`admin.from("ai_conversations").select("id").eq("plan_id", data.id).maybeSingle()` — `error` → 500 `SERVER_ERROR`(讀取路徑一致沿用既有錯誤策略);無列 → `conversation: []`(合法狀態,AC 明定非 404/500)。
   - 有 conversation 時:`admin.from("ai_messages").select("role, content").eq("conversation_id", conv.id).order("id", { ascending: true })` — `error` → 500;結果即 `conversation` 陣列(形狀 `{ role, content }`,決策 4)。此兩查詢的所有權已由外層 `venue_plans` 查詢的 `.eq("user_id", userId)` 錨定(`data.id` 只可能是本人存檔),無需重複過濾。
   - response 增列 `planId: data.id`(見 Architecture Notes 第 1 點),並刪除「task 2 換真查詢」過時註解。GET 以外的 PUT/PATCH/DELETE 一概不動。

5. **修改 `src/lib/ai-panel/messages.ts` 檔頭註解**:在既有「不 import src/lib/ai/(server-only)」段落補一句 —— `PRIOR_IMAGE_PLACEHOLDER` 被 `src/app/api/ai/chat/route.ts`(server)import 作為落庫佔位符的單一事實來源,本模組必須維持 isomorphic(不得引入 server-only 模組或瀏覽器 API)。零程式邏輯變更。

6. **建立 `supabase/tests/ai_conversations_verify.sql`**,比照 `venue_plans_verify.sql` 格式(唯讀 checklist + Expected 註解),涵蓋:兩表欄位形狀、PK(含 `ai_messages.id` 為 identity)、FK cascade 兩條、`plan_id` unique、role check constraint、`ai_messages_conversation_id_id_idx`、兩表 RLS enabled、恰好各一條 select policy、grant(authenticated 僅 SELECT、anon 零 rows、sequence 無 grant)、trigger 綁定、以及註解形式的破壞性段落:authenticated 寫入 permission denied、跨使用者 RLS 隔離(join 路徑)、刪 `venue_plans` 列 cascade 清空 conversation+messages。

7. **更新 `supabase/tests/ai_chat_manual.md`**:追加「planId 對話落庫」段落(案例清單見 Test Plan),並將「未涵蓋」段落中對話持久化相關字樣同步。

8. **更新 `supabase/tests/venue_plans_api_manual.md`**:GET 讀檔段落改寫 `conversation` 斷言(無對話 `[]` / 有對話依序陣列)+ `planId` 欄位存在斷言。

9. **靜態驗證**:`npm run lint` 與 `npx tsc --noEmit` 乾淨;`git status` 確認未觸及 `src/proxy.ts`(`/api/ai/chat` 已受保護,不需 allowlist 變更)、`src/lib/ai/`、既有 migrations。

## Data Flow

```
POST /api/ai/chat(帶 planId)
  cookie session ──getUser()──▶ userId
  body ──▶ messages 驗證(既有)──▶ planId 格式驗證(UUID_RE)──400
  admin.venue_plans.select(id).eq(id, planId).eq(user_id, userId) ──無列──▶ 404(未扣點)
  deductPoints(ai_usage, ai:{uuid}) ──▶ anthropic.messages.create(既有)
  response.content ──▶ 200 回應組裝(既有,形狀不變)
       └─(回應前,try/catch 隔離)persistConversation:
            ai_conversations.upsert(plan_id) ──▶ conversation_id
            ai_messages.insert([user(image→佔位符), assistant(原樣)])
            任一步 throw ──▶ console.error only,response 照常

GET /api/plans/[slot]
  venue_plans(.eq user_id)──▶ { id, slot, name, plan, updated_at }
  ai_conversations.eq(plan_id, id).maybeSingle ──無──▶ conversation: []
       └─有──▶ ai_messages.eq(conversation_id).order(id asc) ──▶ [{role, content}...]
  response: { planId, slot, name, plan, updatedAt, conversation }

刪存檔:DELETE /api/plans/[slot](不動)──▶ DB FK cascade 帶走 conversation + messages
```

## Test Plan

無 JS 測試框架(專案慣例)— BACKEND 驗證為 migration 人工 push + 腳本/curl 實測 + SQL 核對。

### 1. Migration push(人工,前例:20260717010000)
- push 前先以 SQL Editor 確認 `public.set_updated_at()` 存在、`venue_plans` 表存在(FK 依賴)。
- 由使用者經 **session pooler(ap-southeast-1,port 5432)** 手動 push——transaction pooler(6543)有 prepared statement 錯誤前例,勿用;connection string 一律取自環境,不落檔。
- push 後跑 `ai_conversations_verify.sql` 唯讀段落逐項核對(含 sequence 實名確認 `ai_messages_id_seq`)。

### 2. API 行為實測(dev server + 雲端 Supabase;真呼叫模型會花錢/扣點,控制在 ≤4 次模型呼叫,比照 ai_chat_manual.md 慣例;腳本讀 `.env.playwright.local` 帳號,查核用 service_role)
- 不帶 `planId`:成功呼叫一次,response 形狀不變,service_role 查兩張新表零列(**不落庫**)。
- `planId: "not-a-uuid"` → 400,ledger 無新 `ai_usage` 列(格式檢查在扣點前)。
- `planId` 為合法 uuid 但不存在(隨機 uuid)→ 404,ledger 無新列、**餘額不變**(所有權檢查在扣點前;單帳號環境以「不存在的 uuid」替代跨使用者案例,佐以步驟 2 程式碼審視 `.eq("user_id")`,比照 task 1 QA 前例標註)。
- 先 PUT 存檔取得 planId(經 GET 讀檔的 `planId` 欄位),首次帶 planId 呼叫(訊息含一個 image block + text block)→ 200;service_role 查核:恰一列 `ai_conversations`(plan_id 正確)、恰兩列 `ai_messages`(id 升冪 user→assistant;user content 內 image block 已成 `{"type":"text","text":"[使用者先前提供了參考圖]"}` 且 text block 原樣、**無任何 base64 殘留**;assistant content 與 response.content 相同)。
- 同 planId 第二次呼叫 → 仍恰一列 conversation(upsert 未複製)、messages 累計四列且 `updated_at` 已更新。
- `GET /api/plans/[slot]` → `conversation` 為四則 `{role, content}` 依序陣列 + `planId` 欄位;另查一個從未對話的已存檔格 → `conversation: []`(200,非 404)。
- 未登入 POST(帶/不帶 planId)→ 401(既有,proxy 迴歸)。
- `DELETE /api/plans/[slot]` → service_role 複查 conversation/messages 已 cascade 清空。
- 落庫失敗隔離(邊界,靜態驗證):code review 確認 persist 整段在 try/catch 內、catch 僅 console.error、return 路徑不受影響——不做故意弄壞 DB 的實測(雲端共用環境)。
- SQL 層:以 anon key 直打 PostgREST 對兩張新表 INSERT/UPDATE/DELETE → 皆 permission denied(42501,grant 層非 RLS 過濾);authenticated select 只見自己的(join policy)。
- 清理:測試存檔 DELETE(cascade 帶走對話)、測試 `ai_usage` ledger 列以 service_role 沖銷/刪除,餘額復原,service_role 複查零殘留。

### 3. 迴歸
- `npm run lint` + `npx tsc --noEmit` 乾淨。
- 全套 Playwright 迴歸(含 `ai-panel.spec.ts` mock 套件——response 形狀不變、mock 不帶 planId,必須全綠)。

### Edge cases(對應 orchestrator 清單)
- 多個 image block → 逐一各換一個佔位符 block(實測訊息帶兩張圖,落庫應見兩個佔位符 text block)。
- `tool_result` block 原樣落庫(可併入第二次呼叫案例:先取得 tool_use 再回 tool_result)。
- 最後一則非 user role:不防禦、照存(程式碼審視確認無額外擋)。
- upsert race:由 `plan_id` unique + DO UPDATE 消解(決策 3),失敗一律走 log-only 分支。

## Architecture Notes

1. **超出 orchestrator 明文的一項 additive 變更:GET 讀檔 response 增列 `planId`。** orchestrator 未提及,但 task 3 前端讀檔後續聊必須把 `planId` 傳給 `/api/ai/chat`,而目前無任何 API 曝露存檔 uuid——不加則本 task 交付的落庫功能對前端不可觸達。曝露 uuid 無安全風險(chat 端所有權每次重驗)。此為刻意補洞,review 階段請特別確認。
2. `ai_conversations` 沒有獨立的「建立」端點——首次落庫時 lazy create(upsert),與 out-of-scope「無 /api/conversations 路由」一致。
3. 落庫在組 response 之前 `await`(非 fire-and-forget):serverless 環境下 response 送出後的 pending promise 可能被凍結/丟棄,必須等落庫完成(或失敗被 catch)再 return;成本是成功路徑多 2 次 DB round-trip,可接受。
4. `venue_plans` 所有權查詢使 chat 路由在帶 planId 時多一次 DB round-trip;不帶 planId 零開銷(AC 明定現況零變化)。
5. 已知取捨(orchestrator 定案,非遺漏):落庫失敗不補償、不重試(phase 1;`ai_usage` log 為軌跡);扣點與模型呼叫間、模型與落庫間皆非 transaction;100 輪上限與清空對話端點屬 task 3。
6. migration 的 sequence revoke 依 identity 預設命名 `ai_messages_id_seq`;若雲端實名不同(理論不會),push 前以 `\d public.ai_messages` 或 `pg_get_serial_sequence` 確認後修正(比照 20260717070000「先查實名再動」前例)。

## Security Checklist

- [ ] 無硬編 secrets/credentials/connection string(migration push 用環境的 connection string;測試帳號在 `.env.playwright.local`)
- [ ] 輸入驗證在邊界:`planId` uuid 格式白名單驗證後才進 DB 查詢;body 大小上限沿用既有 5MB 檢查
- [ ] 所有權驗證:chat 路由 admin client 查詢**必帶** `.eq("user_id", userId)`(admin 無 RLS,此過濾為安全關鍵);plans GET 的對話查詢以已過濾的 `data.id` 錨定
- [ ] 404 語意不洩漏:存檔不存在與非本人同回 404 同訊息(anti-enumeration 精神)
- [ ] 敏感資料不落 log:落庫失敗 log 僅 planId/refId/錯誤訊息,**不含對話內容**;沿用既有「無 token/key/內容」log 慣例
- [ ] 寫入鎖死 service_role:migration revoke insert/update/delete(anon/authenticated)+ sequence revoke;此為「防偽造 assistant 訊息」的技術屏障,verify SQL 需以 permission denied(42501)確認為 grant 層而非 RLS 過濾
- [ ] `service_role` key 僅經 `src/lib/supabase/admin.ts` factory 於 server route 使用,零 client 元件觸及
- [ ] client 傳來的 `system` 欄位持續被忽略(既有行為不動);落庫 content 中 user 部分視為不可信資料原樣存 jsonb(不執行、不插值),assistant 部分來自 Anthropic 回應
- [ ] 不引入 base64/大 payload 落庫路徑:image block 一律先換佔位符

## Definition of Done

- [ ] Implementation steps 1–9 全部完成
- [ ] Migration 已由人工經 session pooler push 上雲,`ai_conversations_verify.sql` 唯讀段落逐項通過
- [ ] Test Plan 第 2 節 API 實測全數通過,測試資料清理零殘留
- [ ] `npm run lint`、`npx tsc --noEmit` 乾淨;全套 Playwright 迴歸通過(含 ai-panel mock 套件)
- [ ] 無 TODO、無註解掉的程式碼、無 debug log
- [ ] 符合 AGENTS.md 全部規則(factory 使用、server-only 邊界、`/api/*` 慣例、扣點順序)
- [ ] Security checklist 全項通過
