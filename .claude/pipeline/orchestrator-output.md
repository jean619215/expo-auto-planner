# Orchestrator Output — 會員點數系統與商店頁 / Task 2

> Story: stories/points-system.md
> Task 2 of 3: [BACKEND] 點數 API
> Task type: **BACKEND**
> 性質: **補件驗證** — 實作已存在 (commit 5c6c7d7)。驗證既有 API 符合驗收標準,發現缺口才修改。

## 任務描述
三支 API:`GET /api/points/balance`、`POST /api/points/checkout`(PaymentProvider adapter,phase 1 mock)、`POST /api/points/webhook/mock`(HMAC 驗簽 + ref_id 冪等,public 路由)。

## Clarified Acceptance Criteria

### AC1 — GET /api/points/balance
- 未登入 401 `請先登入`(route 自身 getUser 檢查 + proxy 守門雙層)。
- 登入回 200:`{ balance, transactions }` — balance = 全部 delta 加總(user-context client,RLS 保證只算自己的);transactions 最近 20 筆(id/delta/reason/created_at,created_at 降冪)。

### AC2 — POST /api/points/checkout
- 未登入 401。
- body 非 JSON → 400 `請求格式錯誤`;packageId 缺/非字串/查無方案 → 400 `無效的點數方案`。
- 合法方案:以 admin client 建 point_orders(pending,server 端定價快照 — 金額/點數不信任 client),回 200 `{ orderId, redirectUrl }`,redirectUrl 由 provider.createCheckout 產生。

### AC3 — POST /api/points/webhook/mock(public,簽章唯一守門)
- 在 proxy.ts PUBLIC_API_PATHS(已確認 src/proxy.ts:15)。
- 非 JSON / 驗簽失敗 → 400 `invalid webhook`。
- 簽章有效但查無訂單 → 400 同訊息(不洩漏訂單存在性)。
- 訂單已 paid → 200(冪等,不重複發點)。
- 正常路徑:ledger insert(ref_id=`order:{orderId}`)→ 訂單標 paid + provider_txn_id + paid_at。
- webhook 重送:ledger 撞 unique(23505)視為已處理,補標 paid,200 — 兩步中斷可自我修復。
- 簽章驗證用 HMAC-SHA256 + timingSafeEqual(constant-time)。

### AC4 — production 守門
- `getPaymentProvider()`:NODE_ENV=production 且無 MOCK_PAYMENT_SECRET → throw(mock 簽章密鑰預設值不得上線)。

### AC5 — 架構規範符合
- Supabase client 一律走 factories(server.ts/admin.ts),無 inline 建立。
- 錯誤訊息繁中、`{ error }` shape;不 log 秘密。
- checkout 建單走 admin client(orders 無 authenticated insert 權,fail-closed)。

## 驗證方式(BACKEND)
- 對 local dev server(`npm run dev` + 真雲端 Supabase)以 fetch 腳本實測:401/400/200 各分支、webhook 正常/重送/壞簽章/查無單、balance 數字正確性。
- 測試訂單與發點事後以 service_role 清理。
- production 守門:單元式 node 探測(設 NODE_ENV=production 匯入 getPaymentProvider 應 throw)或程式碼靜態核對。
- 更新 `supabase/tests/` checklist(新增 points_api_manual.md)。

## Out of Scope
- 商店頁 UI 與 Playwright(task 3)。

## Assumptions
1. 三方案定價(100/500/1000 TWD)沿用 packages.ts,不議價。
2. webhook「先發點後標單」順序與自我修復設計視為既定架構決策,驗證行為即可。
3. 發現缺口:小缺口直接修;API contract 變更需暫停回報。
