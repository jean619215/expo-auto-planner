# Orchestrator Output — ai_conversations/ai_messages migration + /api/ai/chat 落庫
> Story: 場地儲存檔與 AI 對話持久化 | Generated: 2026-07-22T05:35:00+08:00

## Task Type
BACKEND

## Refined Requirement
在 `venue_plans`(task 1 已上線)基礎上,新增對話持久化層,並讓 `/api/ai/chat` 在帶入 `planId` 時,於模型回應後把「本輪 user 訊息」與「assistant 回應」增量寫入該存檔專屬的對話記錄。落庫僅後端可寫(service_role),前端不可直寫訊息表,防止偽造 assistant 訊息。讀檔 API(`GET /api/plans/[slot]`)把現有 `conversation: []` 佔位換成真實查詢結果。

### 兩張新表(schema 定案,細節同 story 背景決策註解)
- `ai_conversations`
  - `id uuid primary key default gen_random_uuid()`
  - `plan_id uuid not null unique references venue_plans(id) on delete cascade` — 1:1,cascade 帶走對話
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`(重用既有 `public.set_updated_at()` trigger)
- `ai_messages`
  - `id bigint generated always as identity primary key`(插入序即顯示序,不用 uuid)
  - `conversation_id uuid not null references ai_conversations(id) on delete cascade`
  - `role text not null check (role in ('user','assistant'))`
  - `content jsonb not null`(存 Anthropic API 原生 content blocks,讀出直接塞回前端 state,零轉換 — 但圖片 block 已於落庫前換成佔位符文字 block,見下)
  - `created_at timestamptz not null default now()`
  - 建議索引:`(conversation_id, id)` 供讀檔升冪查詢
- RLS/revoke 慣例(同 `venue_plans`):
  - `enable row level security` on both tables
  - `grant select` to `authenticated`;select-own policy 透過 join 回 `venue_plans.user_id = auth.uid()`(`ai_conversations` 直接 join `venue_plans`;`ai_messages` 再 join `ai_conversations`)
  - `revoke insert, update, delete on ai_conversations, ai_messages from anon, authenticated` — 寫入僅 service_role(admin client),此為 AC 明確要求(防前端偽造 assistant 訊息)的技術落地,不只是慣例延續

## Clarified Acceptance Criteria
- [ ] Given 兩表尚不存在,when migration 執行,then `ai_conversations.plan_id` 為 unique FK(cascade),`ai_messages` 為 identity bigint 主鍵,RLS 全開 + select-own policy + revoke insert/update/delete(anon/authenticated),`updated_at` trigger 掛上 `ai_conversations`
- [ ] Given 已登入使用者呼叫 `POST /api/ai/chat` 不帶 `planId`,when 請求成功,then 行為與現況完全相同(不落庫、不查詢兩張新表、response 形狀不變)
- [ ] Given 已登入使用者呼叫 `POST /api/ai/chat` 帶 `planId`(合法 uuid 格式)但該存檔不存在或屬於他人,when 驗證所有權,then 回 404,**不扣點、不呼叫模型**(順序:auth → planId 格式檢查 → 所有權驗證 → 扣點 → 模型呼叫)
- [ ] Given `planId` 格式不是合法 uuid,when 請求進來,then 回 400(沿用 `INVALID_BODY_ERROR` 或等義錯誤,由 architect 定錯誤訊息常數)
- [ ] Given `planId` 合法且屬於該使用者、且該格首次對話(尚無 `ai_conversations` 列),when 模型成功回應,then 後端 find-or-create 一筆 `ai_conversations`(`plan_id` upsert/insert),再寫入本輪 user 訊息 + assistant 回應共兩筆 `ai_messages`
- [ ] Given `planId` 合法且該格已有既有對話,when 模型成功回應,then 直接對既有 `conversation_id` 增量寫入兩筆訊息(不重寫歷史訊息)
- [ ] Given 落庫的 user 訊息 content 內含 image block,when 寫入 `ai_messages.content`,then 每個 image block 個別替換為固定文字 block `{"type":"text","text":"[使用者先前提供了參考圖]"}`(逐一替換,非合併成單一 block;其餘 block type 如 text/tool_result 原樣保留)
- [ ] Given 落庫的 assistant 回應 content,when 寫入,then 原樣存入(`response.content`,不做圖片替換 — Anthropic 回應不含 image block,非本 task 處理範圍)
- [ ] Given 模型已成功回應但落庫(find-or-create conversation 或 insert messages)過程拋錯,when 發生,then 僅 `console.error` log,**回應仍完整回傳前端**(已付費不可丟,同現有「上游失敗不退點」的取捨精神延伸)
- [ ] Given `GET /api/plans/[slot]` 讀檔,when 該格存在,then `conversation` 欄位回傳真實查詢結果(該格對話全部訊息,依插入序/`id` 升冪),而非固定 `[]`
- [ ] Given `GET /api/plans/[slot]` 讀檔,when 該格從未有對話(`ai_conversations` 無對應列),then `conversation` 回傳空陣列 `[]`(非 404、非 500 — 沒對話是合法狀態)
- [ ] Given 未登入,when 呼叫 `POST /api/ai/chat`(不論帶不帶 `planId`),then 回 401(既有行為不變)

## Edge Cases to Handle
- 同一輪 user 訊息同時有多個 image block(例如使用者一次貼兩張圖):每個都各自換成一個佔位符 text block,不合併成一句。
- user 訊息 content 內含 `tool_result` block(承接上一輪 tool_use 的情境):原樣落庫,不做任何轉換(不是 image、不需佔位符)。
- `messages` 陣列最後一則的 role 理論上必為 `"user"`(前端 `toApiMessages` 契約保證);若非 user(理論不應發生),落庫階段仍以陣列最後一個元素為準,不額外防禦性擋——與現有 `isValidRoles` 驗證邊界一致,不在本 task 擴大處理。
- 高頻但非本 task 範圍:單格對話 100 輪軟上限的**顯示**由 task 3(FRONTEND)處理;本 task 後端不做任何筆數上限攔阻或警告。
- `find-or-create` 的併發競態(理論上同一使用者不會對同一 `planId` 同時發兩個對話請求,但若發生):`plan_id` 有 unique constraint,故用 `upsert(... , { onConflict: "plan_id", ignoreDuplicates: false })` 或先 select 再視情況 insert 皆需避免重複列;架構細節由 architect 決定,但落庫失敗(含 race 導致的 unique violation)一律走上面「僅 log、不影響回應」的分支。

## Error States
- 未登入 → 401(不變)
- `planId` 格式非法(非 uuid) → 400
- `planId` 合法但存檔不存在/非本人 → 404,**發生在扣點之前**,不產生任何 `ai_usage` ledger 紀錄
- 模型上游失敗(既有邏輯:400 client 造成 / 502 其餘) → 不變,此時**不觸發落庫**(沒有 response.content 可存)
- 落庫失敗(find-or-create 或 insert 任一步驟出錯) → log only,response 照常 200 回傳,不影響使用者

## Out of Scope
- `GET /api/plans/[slot]` 之外,不新增任何「單獨查訊息」或「對話列表」API — 讀檔 API 已含對話,符合 1:1 聚合根設計。
- 「清空對話」功能(AC 提到的 `AI 面板提供「清空對話」`)**不在本 task 範圍** — 本 task 只做兩表 migration + chat 路由落庫 + 讀檔真查詢。清空對話需要的刪除訊息端點(例如 `DELETE /api/plans/[slot]/conversation` 或類似)留給 task 3(FRONTEND:存檔 UI + AiPanel 續聊/清空對話)階段的 orchestrator/architect 決定歸屬與介面 — 標記為後續 gap,非本 task 遺漏。
- 100 輪軟上限的判斷與提示 UI:task 3 範圍。
- 歷史圖片訊息的還原顯示 UI(「📷 參考圖」占位):task 3 範圍;本 task 只保證落庫的是文字佔位符字串,不處理前端如何渲染它。
- `ai_conversations`/`ai_messages` 沒有另外的 REST 路由(如 `/api/conversations`);唯一入口是 `/api/ai/chat`(寫)與 `/api/plans/[slot]`(讀)。

## Assumptions Made
1. **落庫的 user 訊息內容 = 前端送來的 `messages` 陣列最後一個元素原樣**(即模型呼叫當下實際使用的那一版,已含 `[目前配置]` 附錄文字),僅做 image block → 佔位符 的轉換,不做其他瘦身/裁切。理由:這樣讀檔還原續聊時,歷史訊息與「當初實際送給模型的內容」一致,也與現有 `toApiMessages` 對「最新一輪原樣送出」的契約對稱。
2. `PRIOR_IMAGE_PLACEHOLDER` 常數(`src/lib/ai-panel/messages.ts`)是 client 模組(無 `server-only`),`/api/ai/chat` 屬於 server-only 邊界(`src/lib/ai/` 慣例)。是否讓 server 端 import 該 client 常數、或在 server 端複製同字串值,由 architect 決定實作方式;**唯一硬性要求是兩處字串值必須完全相同**(否則讀檔還原的歷史圖片訊息會與前端判斷邏輯對不上)。
3. `GET /api/plans/[slot]` 回傳的每則訊息形狀比照 `ai_messages` 欄位精簡為 `{ role, content }`(可直接餵回前端 state 續聊,零轉換);是否額外帶 `id`/`createdAt` 供未來使用(例如渲染 key 或除錯)由 architect 決定,但**不得為了帶 `id` 而把 bigint 序列化成 JS number**(超過 `Number.MAX_SAFE_INTEGER` 風險低但仍應以字串序列化,若真的需要帶出的話)。
4. `planId` 驗證放在扣點之前(而非模型呼叫前的任意位置)是刻意順序:確保無效/越權的 `planId` 不會產生扣點副作用,對齊 AC「跨使用者存取他人 planId 回 404」與「模型已回應才不可退點」的取捨精神——404 情境下使用者根本沒觸發到那條規則。
5. `find-or-create` 對話列的判斷本身**不算落庫失敗的一部分而中止整個請求**——只要模型已回應,不論 find-or-create 或後續 insert 哪一步出錯,一律走「log only、response 照常回傳」分支,不做部分回滾或部分成功的特殊處理。

## Security Notes
- 寫入路徑鎖死於 service_role(admin client):`revoke insert/update/delete` 給 anon/authenticated 是本 task 防止「前端直接寫 `ai_messages` 偽造 assistant 訊息」的唯一技術屏障,migration 必須落實,不可只靠應用層檢查。
- `ai_conversations`/`ai_messages` 的 RLS select-own 需正確 join 回 `venue_plans.user_id`(而非誤植成不存在的 `user_id` 欄位在這兩張新表上——這兩張表本身都不直接存 `user_id`,必須透過 `plan_id`/`conversation_id` 逐層 join 驗證擁有權)。
- `planId` 所有權驗證必須用 admin client 查詢並手動 `.eq("user_id", userId)`(比照 `venue_plans` 既有慣例,admin client 無 RLS,過濾邏輯是安全關鍵,不可省略)。
- 落庫寫入的 `content` 來源分兩類:user 訊息來自前端請求 body(不可信,但已通過現有 `isValidRoles` 等驗證且落庫前只做 image→佔位符 轉換,不做其他信任升級);assistant 訊息來自 Anthropic API 回應(視為可信的一方資料,原樣存入)。
- 不因本 task 引入任何新的 base64/大型 payload 落庫路徑——圖片一律於落庫前替換為佔位符文字,`content jsonb` 欄位不會因圖片而肥大。
