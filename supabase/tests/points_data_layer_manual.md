# 點數資料層 手動驗證 Checklist

> 對象:migration `20260716080000_create_points.sql`(point_transactions / point_orders / handle_new_user 贈點 / backfill)
> 驗證方式:@supabase/supabase-js 腳本對雲端專案探測(憑證取自 `.env.local` + `.env.playwright.local`,勿硬編)。
> 首次執行:2026-07-17,12/12 + trigger 即時探測 全數通過。

## Schema 存在性(service_role)
- [x] `point_transactions` 可 select 全欄位:id, user_id, delta, reason, ref_id, created_at
- [x] `point_orders` 可 select 全欄位:id, user_id, package_id, amount_twd, points, status, provider, provider_txn_id, created_at, paid_at

## RLS / 權限
- [x] 未登入(anon key、無 session)select `point_transactions` → 回空陣列
- [x] 登入者(Playwright 測試帳號)select → 只回自己的列
- [x] 登入者 insert `point_transactions`(delta=999)→ 被拒:`permission denied`(revoke 後)或 RLS 拒絕
- [x] 登入者 insert `point_orders` → 被拒(同上)
- [x] 登入者 update `point_transactions`(改 delta)→ 被拒(append-only:ledger 不可改寫)
- [x] 登入者 delete `point_transactions` → 被拒
- [x] 登入者 update / delete `point_orders` → 被拒
- [x] service_role insert `point_transactions` → 成功(測試列事後以 service_role delete 清除)

## 註冊贈點 trigger + backfill
- [x] 每個 `auth.users` 帳號恰有一筆 `reason='signup_bonus'`、`delta=50`、`ref_id='signup:{user_id}'`
- [x] 既有帳號(migration 前註冊)的 bonus 由 backfill 產生(created_at = migration 套用時間)
- [x] trigger 即時路徑:admin.createUser 建臨時帳號 → ledger 立即出現 50 點 signup_bonus + profiles 列 → deleteUser 清除,cascade 連帶清 ledger,無殘料

## 冪等(DB 層)
- [x] 對既有 user 重插 `ref_id='signup:{uid}'` → `duplicate key value violates unique constraint "point_transactions_ref_id_key"`

## 重跑指引
腳本範本:建 admin client(service_role)+ user client(anon key 登入測試帳號),依上列項目逐項探測。
注意:
- 探測性 insert 一律用一次性 ref_id 或既有 ref_id(預期失敗),成功寫入的測試列必須以 service_role delete 清除。
- trigger 探測用完即刪的臨時帳號(email `pipeline-trigger-probe-*@example.com`),刪除靠 `auth.admin.deleteUser`(FK on delete cascade 清 ledger/orders/profiles)。
