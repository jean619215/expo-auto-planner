# QA Report — 會員點數系統與商店頁 / Task 2 [BACKEND] 點數 API
> Generated: 2026-07-17T04:33:29Z | QA iteration: 1
> 性質:補件驗證獨立重測(不採信 implement/review 報告文字,自行對 local dev server + 真雲端 Supabase 重跑)。

## Summary
- Tests executed: 35 (18 既有 checklist 項 + 13 額外 edge case + 4 production 守門探測)
- Passed: 35
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — 所有 AC1-AC5 通過,無 Critical/High/Medium/Low bug。

## Acceptance Criteria Results

| Criterion | Result | Notes |
|---|---|---|
| AC1 — 未登入 balance → 401 `請先登入` | ✅ PASS | status=401, error="請先登入" |
| AC1 — 登入 balance = ledger delta 總和 | ✅ PASS | api=850, service_role 平行加總=850,一致 |
| AC1 — transactions ≤20 筆、created_at 降冪 | ✅ PASS | n=9(帳號現有交易數 <20),降冪排序驗證通過 |
| AC2 — 未登入 checkout → 401 | ✅ PASS | status=401 |
| AC2 — body 非 JSON → 400 `請求格式錯誤` | ✅ PASS | status=400 |
| AC2 — packageId 非字串/查無方案 → 400 `無效的點數方案` | ✅ PASS | 兩分支皆 400,error 訊息正確 |
| AC2 — 合法方案 → 200 { orderId, redirectUrl },server 端定價快照 | ✅ PASS | body 夾帶偽造 amountTwd=1/points=99999 被忽略;DB 訂單 amount_twd=100, points=100, provider=mock, user_id 正確 |
| AC3 — 壞簽章 → 400 `invalid webhook`,訂單不變、不發點 | ✅ PASS | 訂單仍 pending |
| AC3 — 簽章有效但查無單 → 400 同訊息(不洩漏存在性) | ✅ PASS | status 與 message 皆與壞簽章情境一致 |
| AC3 — 正確簽章 → 200,ledger +points、訂單 paid+provider_txn_id+paid_at | ✅ PASS | ledger 1 筆 delta=100;訂單三欄位皆正確寫入 |
| AC3 — webhook 重送(冪等)→ 200,ledger 不重複 | ✅ PASS | 重送後 ledger 仍 1 筆 |
| AC3 — public allowlist 生效(無 cookie 可打通)vs 對照組非 allowlist 路由 401 | ✅ PASS | webhook 全程無 cookie 成功;/api/points/balance 無 cookie → 401 |
| AC4 — production 且無 MOCK_PAYMENT_SECRET → getPaymentProvider() throw | ✅ PASS | 訊息:"PAYMENT_PROVIDER=mock 在 production 需明確設定 MOCK_PAYMENT_SECRET" |
| AC5 — 架構規範(factory 使用/錯誤 shape/繁中訊息/admin client 使用點) | ✅ PASS | 靜態核對三支 route + provider.ts + proxy.ts 原始碼(非僅引用 review 結論),確認無 inline Supabase client、無秘密 log、checkout 走 admin insert、balance 走 user-context client 依賴 RLS |

## Edge Case Results

| Edge Case | Result | Notes |
|---|---|---|
| checkout body = `null`(合法 JSON,非 object) | ✅ PASS | 400 無效的點數方案 |
| checkout body = `[]`(array) | ✅ PASS | 400 |
| checkout body = `{}`(缺 packageId) | ✅ PASS | 400 |
| checkout packageId = `""`(空字串) | ✅ PASS | 400 |
| webhook payload 缺 sig 欄位 | ✅ PASS | 400 |
| webhook sig = `""`(空字串) | ✅ PASS | 400,`safeEqualHex` 對長度 0 直接 fail-closed |
| webhook sig 非 hex 字元 | ✅ PASS | 400,Buffer.from hex 解碼長度不符 |
| webhook sig 長度不符(短於 HMAC-SHA256 輸出) | ✅ PASS | 400 |
| webhook payload = array | ✅ PASS | 400 |
| webhook payload = `null`(合法 JSON) | ✅ PASS | 400 |
| checkout 三方案(basic/plus/mega)定價快照皆正確 | ✅ PASS | amount_twd/points 逐一核對:100/100、500/550、1000/1200 |
| production 守門控制組:production + 有設 secret → 不 throw | ✅ PASS | 排除「production 恆 throw」假陽性,證明門檻確實綁在「無 secret」而非環境本身 |
| production 守門控制組:dev + 無 secret → 不 throw | ✅ PASS | 排除「恆 throw」假陽性,確認僅 production 環境觸發 |
| production + 不支援的 PAYMENT_PROVIDER → throw | ✅ PASS | 訊息:"未支援的 PAYMENT_PROVIDER: ecpay" |

> 併發雙 webhook(review 💡 已論證無資損)本輪未重測,依 architect-plan 假設 2 視為既定架構決策,僅驗證行為分支(壞簽章/查無單/正常/重送/production 守門),不追加額外併發測試。

## Error State Results

| Error State | Result | Notes |
|---|---|---|
| balance 未登入 401 | ✅ PASS | 同上 AC1 |
| checkout 未登入 401 / 400 系列 | ✅ PASS | 同上 AC2 |
| webhook 400 系列(壞簽章/查無單/非 JSON/缺欄位/空 sig/非 hex/array/null payload) | ✅ PASS | 同上 AC3 + edge case |
| DB 查詢失敗 → 500(balance/checkout/webhook 皆有 error.code/message 分支) | 未觸發實測 | 靜態核對程式碼路徑存在且訊息不洩漏秘密(console.error 僅記 code/message);無安全手段可在真雲端 Supabase 上人為製造 DB 層失敗,依 review 靜態結論採信 |

## Regression Check

| Feature | Result |
|---|---|
| /api/auth/login(balance/checkout 測試流程依賴的登入)| ✅ PASS(測試前置步驟成功取得 session cookie) |
| proxy.ts 既有受保護頁面/路由守門(/profile 等未變更範圍)| ✅ PASS(靜態核對 PROTECTED_PAGES/matcher 僅新增 /shop 相關項,未動既有項目) |
| point_transactions RLS select_own(balance API 依賴)| ✅ PASS(登入帳號僅取回自己交易,加總與 service_role 平行查核一致) |

## Security Test
- Sensitive data exposure: PASS — 回應 body 僅含 balance/transactions/orderId/redirectUrl/error;無 token/cookie/秘密外洩;console.error 僅記 error.code/message
- Input validation: PASS — checkout body 型別逐項驗證(null/array/缺欄位/空字串皆擋);webhook payload 型別驗證 + HMAC-SHA256 timingSafeEqual(空 sig/非 hex/短長度皆 fail-closed)
- Auth boundary: PASS — balance/checkout 雙層守門(route getUser + proxy 頁面/API 保護);webhook 為 public allowlist 路由,簽章驗證先於任何 DB 操作,壞簽章與查無單回相同 status+message(anti-enumeration 符合 status code 顯式相等要求)

## Bugs Found
無。

## Test Coverage
- New code coverage: 手動驗證涵蓋三支 route 全部分支(balance 2 分支、checkout 5 分支、webhook 7 分支)+ production 守門 4 案例,共 35 項獨立重測全數 PASS
- Minimum required: 依 AGENTS.md,BACKEND 任務無強制數字覆蓋率門檻,僅要求「新邏輯需有測試覆蓋(manual checklist 或 Playwright 皆可)」— 本任務以 `supabase/tests/points_api_manual.md` + 本報告的獨立重測滿足
- Status: PASS

## 補充說明
- lint(`npm run lint`)乾淨,無新增警告/錯誤。
- 測試訂單與發點均以 service_role 於腳本內清理(checkout/webhook 主流程訂單、三方案定價驗證訂單皆已 delete)。資料庫中殘留的 2026-07-16 pending/paid 訂單為先前 implement/review 階段遺留,非本輪 QA 產生,不在本任務清理責任範圍內(供人工留意,未列為 bug — 對應 review 💡 建議 2「pending 訂單無清理機制」已知風險)。
