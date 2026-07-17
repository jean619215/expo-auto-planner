# Orchestrator Output — 會員點數系統與商店頁 / Task 1

> Story: stories/points-system.md
> Task 1 of 3: [BACKEND] 點數資料層
> Task type: **BACKEND**
> 性質: **補件驗證** — 實作已存在 (commit 5c6c7d7, migration 已推雲端 Supabase)。目標是驗證既有實作符合驗收標準,發現缺口才修改,不重新實作。

## 任務描述
points ledger(append-only)+ orders 資料表 migration(`supabase/migrations/20260716080000_create_points.sql`),RLS read-own、寫入僅 service_role,auth trigger 發 50 點註冊禮 + 既有帳號 backfill。

## Clarified Acceptance Criteria

### AC1 — point_transactions 資料表(append-only ledger)
- 欄位:id (uuid PK)、user_id (FK auth.users, on delete cascade)、delta (integer, `<> 0` check)、reason (`signup_bonus` | `purchase` check)、ref_id (text, **unique**)、created_at。
- 無可變 balance 欄位;餘額由 `SUM(delta)` 導出。
- user_id 有 index。

### AC2 — point_orders 資料表
- 欄位:id、user_id (FK)、package_id、amount_twd (>0 check)、points (>0 check)、status (`pending`/`paid`/`failed` check, default pending)、provider (`mock`/`ecpay` check)、provider_txn_id、created_at、paid_at。
- 定價於建單時快照(amount_twd/points 存在 order 列上)。

### AC3 — RLS:讀自己的、寫僅 service_role
- 兩表皆 enable RLS。
- `authenticated` 僅 grant SELECT + select-own policy(`auth.uid() = user_id`)。
- **不 grant** insert/update/delete 給 authenticated/anon — 以 anon key + 使用者 session 嘗試 INSERT 必須失敗。
- service_role(admin client)可寫入。

### AC4 — 註冊贈 50 點(trigger)
- `handle_new_user()` 擴充:profiles 建立之外,插入 delta=50、reason=signup_bonus、ref_id=`signup:{user_id}` 的 ledger 列。
- SECURITY DEFINER + `set search_path = ''`。
- 冪等:`on conflict (ref_id) do nothing` — trigger 重放不重複發點。

### AC5 — 既有帳號 backfill
- migration 內一次性 INSERT ... SELECT 對所有 auth.users 補發,`on conflict do nothing` 保證重跑安全。
- 雲端專案上所有既有帳號各有恰好一筆 signup_bonus。

### AC6 — 冪等由 DB 承擔
- ref_id unique constraint 是唯一去重機制;應用層不做 dedup。重複 ref_id 插入被 DB 擋下。

## 驗證方式(BACKEND — 無 JS 測試框架)
- SQL 驗證:對雲端 Supabase 跑查詢確認 schema/RLS/policy/grant/trigger 存在且行為正確(可用 supabase CLI 或 SQL editor;唯讀查詢 + 可回滾的行為探測)。
- RLS 行為驗證:以 authenticated 情境嘗試讀他人列(應空)與寫入(應拒絕)。
- 依專案慣例補/更新 `supabase/tests/` 下的手動驗證資料(若既有 checklist 模式適用)。

## Out of Scope(後續 task)
- API routes(task 2)、商店頁/Playwright(task 3)。

## Assumptions(未逐題澄清,補件模式)
1. Migration 已套用到雲端專案 — 驗證時不重跑 migration,只驗證現況。
2. 50 點數字、三方案定價沿用既有實作,不再議價。
3. 發現缺口時:小缺口直接以新 migration 修補;schema 級重大缺口暫停回報人工。
