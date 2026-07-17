# Architect Plan — 會員點數系統與商店頁 / Task 1(補件驗證)

> Task: [BACKEND] 點數資料層 — points ledger + orders migration + RLS + trigger 贈點 + backfill
> 性質:驗證既有實作(migration `20260716080000_create_points.sql`,已推雲端)。發現缺口才修改。

## 前提
- 不重跑 migration;對雲端專案現況驗證。
- 憑證:`.env.local`(anon key、service_role key、專案 URL);Playwright 測試帳號在 `.env.playwright.local`,可借用作 authenticated 情境。
- 專案無 psql 直連慣例 — 驗證優先用 @supabase/supabase-js 腳本(scratchpad 內,不進 repo);schema 層查詢若 PostgREST 不可及,退而用 supabase CLI(`supabase db …`)或標記為「以 migration 原始碼靜態核對」。

## 驗證步驟(對應 orchestrator AC)

### Step 1 — 靜態核對 migration 原始碼(AC1/AC2/AC4/AC5/AC6)
逐條比對 `supabase/migrations/20260716080000_create_points.sql` 與 AC:欄位、check constraints、ref_id unique、index、RLS enable、policy 定義、grant 範圍、trigger function(SECURITY DEFINER + search_path='' + on conflict do nothing)、backfill 語句。
已知風險點(review 階段須確認):
- `handle_new_user` 為 `create or replace` — 需確認替換後仍保留 profiles 建立行為(migration 內有,OK),且 trigger `on_auth_user_created` 本身在早前 migration 已綁定、未被 drop。
- `point_orders.ref_id` 不存在 — 冪等鍵在 point_transactions;orders 冪等由 task 2 webhook 邏輯處理(order status 檢查),本 task 不管。

### Step 2 — 雲端 schema 存在性驗證(AC1/AC2)
service_role client 對兩表各做一次 `select ... limit 1` 與 `head:true count` — 確認表存在且可讀。欄位存在性:以 select 指名全部欄位驗證。

### Step 3 — RLS 行為驗證(AC3)
node 腳本(scratchpad):
1. anon client + 測試帳號登入(`.env.playwright.local` 帳密)。
2. `select` point_transactions — 應只回自己的列(該帳號應有 signup:{uid} 一筆)。
3. `insert` point_transactions(delta=999)— 應被拒(RLS/權限錯誤)。
4. `insert` point_orders — 應被拒。
5. 未登入 anon client `select` — 應回空(anon 無 policy)。
6. service_role client insert 一筆測試列後 **delete 清除**(驗證寫入權;delete 用 service_role,不留殘料)。註:ledger append-only 是應用層守則,service_role 技術上可 delete,清理測試資料屬合法用途。

### Step 4 — trigger 與 backfill 驗證(AC4/AC5)
service_role 查詢:
1. 每個 auth.users 都恰有一筆 reason='signup_bonus'、ref_id='signup:{id}'、delta=50(以 service_role 查 point_transactions 核對 auth.admin listUsers 名單)。
2. 冪等探測:service_role 對既有 user 重插 ref_id='signup:{id}' — 一般 insert 應撞 unique constraint 失敗(即 DB 層冪等成立;`on conflict do nothing` 行為屬 migration 語句內部,已由 Step 1 靜態核對)。
3. (若 Playwright 測試帳號註冊時間晚於 migration:該帳號的 signup_bonus 由 trigger 而非 backfill 產生 — 兩者殊途同歸,不需區分。)

### Step 5 — 手動測試文件
`supabase/tests/` 新增 `points_data_layer_manual.md` checklist:記錄上述查詢與預期結果,供日後回歸。(專案慣例:BACKEND 驗證留 checklist。)

## 產出物
- scratchpad 驗證腳本(不進 repo)
- `supabase/tests/points_data_layer_manual.md`(進 repo)
- 驗證結果記入 task-log 與後續 qa-report

## Escalation 檢查
- 無 API contract 變更、無新 schema 變更(除非驗證發現缺口)、無 auth 流程變更。auth trigger 屬 auth-adjacent — review 階段依規自動 🔴 Critical 檢視,但本 task 只驗證不改動。
- 規模在 story 範圍內。無 escalation。
