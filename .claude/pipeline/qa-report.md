# QA Report — 會員點數系統與商店頁 / Task 1 [BACKEND] 點數資料層
> Generated: 2026-07-17T04:15:33Z | QA iteration: 1
> 性質:補件驗證 — 獨立重測(不採信 implement/review 階段報告),對雲端 Supabase 實測。

## Summary
- Tests executed: 19 (12 主腳本 + 6 UPDATE/DELETE 拒絕探測 + 1 trigger 即時探測)
- Passed: 19
- Failed: 0
- Blocked: 0

## Recommendation
**APPROVED**

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| AC1 — point_transactions 表結構(欄位/check/unique ref_id/index) | ✅ PASS | service_role select 全欄位成功;migration 原始碼核對 `delta <> 0`、`reason in (...)`、`ref_id unique`、`user_id` index 皆存在 |
| AC2 — point_orders 表結構 | ✅ PASS | service_role select 全欄位成功;migration 核對 `amount_twd > 0`、`points > 0`、`status`/`provider` check、default pending 皆存在 |
| AC3 — RLS 讀自己的、寫僅 service_role | ✅ PASS | 未登入 select 回空(0 rows);登入者 select 只回自己的列(9 rows,全為本人 user_id);登入者 insert/update/delete 兩表皆 `permission denied for table ...`(**privilege 層**拒絕,非僅 RLS 訊息 — 確認 20260717010000 revoke migration 已生效);service_role insert 成功且事後清除 |
| AC4 — 註冊贈 50 點 trigger(SECURITY DEFINER + search_path='' + 冪等) | ✅ PASS | 即時探測:`pipeline-trigger-probe-*@example.com` 臨時帳號建立後,ledger 立即出現恰一筆 `delta=50, reason=signup_bonus, ref_id=signup:{uid}` + profiles 列同時存在;deleteUser 後 cascade 清除 ledger,無殘料 |
| AC5 — 既有帳號 backfill | ✅ PASS | 全 5 個 auth.users 帳號各恰有一筆 signup_bonus(missing=0, dupes=0),delta 全為 50,ref_id 格式全符合 `signup:{uid}` |
| AC6 — 冪等由 DB(ref_id unique)承擔 | ✅ PASS | 對既有 user 重插 `ref_id=signup:{uid}` → `duplicate key value violates unique constraint "point_transactions_ref_id_key"`,插入被擋 |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 未登入(無 session)select point_transactions | ✅ PASS | 回空陣列,非錯誤 |
| authenticated UPDATE point_transactions(改 delta,ledger 竄改防護) | ✅ PASS | `permission denied for table point_transactions` |
| authenticated DELETE point_transactions | ✅ PASS | `permission denied for table point_transactions` |
| authenticated UPDATE point_orders | ✅ PASS | `permission denied for table point_orders` |
| authenticated DELETE point_orders | ✅ PASS | `permission denied for table point_orders` |
| authenticated 讀自己的列在 revoke 後仍正常(防禦層變動未誤傷讀權) | ✅ PASS | `read own still works: yes` |
| trigger 重放(on conflict do nothing 語意,經冪等測試間接驗證) | ✅ PASS | 見 AC6 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| authenticated 寫入 ledger/orders(任一操作)一律回傳 permission denied,不洩漏資料存在與否 | ✅ PASS | 訊息一致為 `permission denied for table <table>`,不因目標列是否存在而不同 |
| 重複 ref_id 插入 | ✅ PASS | 明確的 unique constraint violation 錯誤,非靜默失敗 |

## Regression Check
| Feature | Result |
|---|---|
| profiles 建立(handle_new_user 原有行為,經 create or replace 後) | ✅ PASS | 即時探測中 profile row 與 ledger 列同時產生,`on_auth_user_created` trigger 綁定未受影響 |
| 既有帳號讀取(users=5, tx rows=13:5 signup_bonus + 8 舊有 purchase 測試資料)未被本次驗證動作污染 | ✅ PASS | 驗證前後比對 ledger 列數與內容,無殘留探測列 |

## Security Test
- Sensitive data exposure: **PASS** — 憑證僅由腳本讀取 `.env.local`/`.env.playwright.local`,未印出任何 key/token/session 值;QA 報告與腳本輸出均不含憑證明文
- Input validation: **PASS** — check constraints(delta<>0、reason/status/provider 白名單、amount_twd/points>0)存在於 migration,唯一性由 ref_id unique 承擔
- Auth boundary: **PASS** — authenticated 對兩表的 SELECT 僅限自己列(RLS `auth.uid() = user_id`);INSERT/UPDATE/DELETE 對 anon/authenticated 一律 privilege 層拒絕(revoke migration `20260717010000` 已確認在雲端生效,錯誤訊息為 `permission denied`,非僅 RLS 訊息);service_role 不受限制,符合設計

## Bugs Found
無。

Review 階段兩項 🟡 Should Fix 已於 QA 階段獨立重測確認皆已修復落地:
- Issue 1(privilege 層防線)— `20260717010000_revoke_points_writes.sql` 已套用雲端,authenticated insert/update/delete 錯誤訊息由 RLS 訊息變為 `permission denied`(privilege 層),雙層防禦確認生效。
- Issue 2(checklist 缺 UPDATE/DELETE 探測)— `supabase/tests/points_data_layer_manual.md` 已補上 6 項 UPDATE/DELETE 拒絕探測,QA 獨立重跑後全數 PASS。

## Test Coverage
- New code coverage: 6/6 AC(100%),13 條 checklist 項目全通過,QA 獨立重測額外含 6 條 UPDATE/DELETE 探測 + 1 條即時 trigger 探測,共 19 項驗證動作
- Minimum required: BACKEND task — 手動 checklist 覆蓋全部 AC(AGENTS.md Testing Requirements)
- Status: **PASS**

## 附註 — 驗證方式與清理紀錄
- 驗證腳本:`verify-points-data-layer.mjs`(12 項主檢查)、`check-revoke2.mjs`(6 項 UPDATE/DELETE 拒絕探測)、`check-trigger-fire.mjs`(即時 trigger + cascade 清理探測),皆位於 scratchpad,不進 repo。
- 執行環境:`~/.nvm/versions/node/v22.21.1/bin/node`(系統預設 node 20 缺原生 WebSocket,supabase-js realtime 依賴會報錯)。
- 探測性寫入清理:主腳本 service_role 測試列(`verify-test:{ts}`)已由腳本自身 delete 清除;trigger 探測用臨時帳號 `pipeline-trigger-probe-*@example.com` 已 `deleteUser`,cascade 確認清除對應 ledger/profiles 列。驗證後查詢 ledger 全表(13 rows),內容為 5 筆 signup_bonus + 8 筆既有 purchase 測試資料(非本次驗證產生),無殘留探測資料。
