# Code Review Report — 會員點數系統與商店頁 / Task 2 [BACKEND] 點數 API
> Generated: 2026-07-17 | Review iteration: 1
> 性質:補件驗證 review — 標的為 commit 5c6c7d7 中的 balance/checkout/webhook 三支 route、provider.ts、packages.ts、proxy.ts 變更,與工作樹新增的 `supabase/tests/points_api_manual.md`。
> Auth-adjacent 範圍(webhook public 路由 + 簽章唯一守門)依 AGENTS.md 以 🔴 Critical 等級全面檢視。

## Overall Assessment
APPROVED

## Summary
三支 route + provider/packages + proxy.ts 變更均符合 AGENTS.md 架構與安全規範。webhook 安全鏈完整:JSON parse → HMAC-SHA256 驗簽(timingSafeEqual,constant-time)先於一切 DB 操作;壞簽章與「簽章有效但查無單」回相同 400 + `invalid webhook`(status 與 message 皆一致,符合 anti-enumeration 的顯式 status 等值要求);ledger unique ref_id 冪等 + 23505 分支使「發點成功但標單失敗」可經重送自我修復。無 Critical、無 Should Fix,僅三項 Consider 級註記。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

### 重點審查結論(webhook,auth-adjacent 逐項核)
- **驗簽先於 DB**:route 流程為 parse JSON → `verifyWebhook` → 才建 admin client 查單。未過驗簽零 DB 接觸。✅
- **Timing-safe compare**:`safeEqualHex` 先比長度再 `timingSafeEqual`;空 sig / 非 hex / 奇數長度均因 Buffer 解碼長度不符而 fail-closed。長度檢查僅洩漏公開資訊(HMAC-SHA256 輸出長度)。✅
- **錯誤訊息不洩漏內部狀態**:壞簽章與查無單同為 400 `invalid webhook`(status code 相等,非僅訊息相同 — 符合 register 舊 bug 的教訓)。DB 故障回 500 `server error`,不含訂單資訊。✅
- **重送/部分失敗自我修復**:先寫 ledger(ref_id `order:{id}` unique,migration 已核有 constraint)再標單;標單失敗回 500 → 金流商重送 → insert 撞 23505 視為已處理 → 補標 paid。已 paid 早退 200。併發雙 webhook:一方 23505、update 帶 `.eq("status","pending")` 條件,0-row update 無害。邏輯正確。✅
- **金額信任邊界**:簽章只綁 orderId|txnId,發點數量取自 DB 訂單列(server 端快照),payload 帶的 amount/points 完全不被使用 — 偽造金額無效。✅
- **Production 守門**:`getPaymentProvider()` 於 NODE_ENV=production 且無 MOCK_PAYMENT_SECRET 時 throw;未知 provider 亦 throw。✅(implement 階段 node 探測 PASS)
- **proxy.ts**:PUBLIC_API_PATHS 僅加 `/api/points/webhook/mock` 且附守門說明註解;`/shop` 同步加入 PROTECTED_PAGES 與 config.matcher 兩處(含 `/shop/:path*`),符合 AGENTS.md 雙更新規則。✅

### checkout / balance 審查結論
- **checkout race**:同 user 併發建單僅產生多筆 pending 訂單,點數只在 webhook paid 時發放,無資損路徑。✅
- **checkout 金額信任邊界**:amount_twd/points 一律取 `findPackage` 的 server 端定價快照,client body 只取 packageId(型別驗證);admin client 建單(orders 無 authenticated insert policy,fail-closed)。✅(實測含偽造金額拒收證據)
- **balance RLS 依賴**:user-context client 查 `point_transactions`,依賴 `point_transactions_select_own` policy(migration 已核存在)。✅
- **AGENTS.md 規範**:三支 route 均走 `src/lib/supabase/` factories,無 inline client;`{ error }` shape、繁中訊息(webhook 對機器回英文為既定 contract);console.error 只記 error.code/message,無 token/cookie/秘密。✅

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### 1. balance 全取加總的成長上限
- **File**: src/app/api/points/balance/route.ts:18-28
- 全取交易列於 server 端 reduce 加總,程式內註解已明示現階段規模可接受、量大改 DB 端聚合(rpc/view)。註記合理,僅提醒:交易數破千後宜提前處理,屆時同時給 `created_at` 加索引。

### 2. pending 訂單無清理/上限機制
- **File**: src/app/api/points/checkout/route.ts:44-55
- 已登入使用者可重複建單累積 pending 列(棄單不清理)。無資損,但長期會堆積;未來可加定期清理或同 user pending 上限。

### 3. Mock 簽章隨 redirectUrl 進入瀏覽器 — ECPay 換裝時注意
- **File**: src/lib/points/provider.ts:46-59
- Mock 設計下有效簽章隨付款頁 URL 交付 client(mock「付款」本就是按鈕,無實質差異)。換 EcpayProvider 時,CheckMacValue 驗證素材必須來自金流商 server-to-server 通知,絕不可由本端預簽後經瀏覽器繞回 — 建議屆時在 adapter 介面註解明示。

## Security Assessment
- Secrets scan: PASS(無硬編碼秘密;MOCK_SECRET 讀 env,dev 預設值有 production throw 守門)
- Input validation: PASS(checkout body 型別逐項驗;webhook payload 型別驗 + HMAC)
- Auth/authz: PASS(balance/checkout 雙層守門 route getUser + proxy;webhook 簽章唯一守門且驗簽先於 DB;anti-enumeration status+message 皆一致)
- No sensitive data in logs: PASS(僅 error.code/message)
- CORS/CSP: 未變更
- SQL injection: N/A(supabase-js 參數化)
- Test coverage: 18/18 dev server 實測 + production 守門探測 PASS;checklist 落檔 supabase/tests/points_api_manual.md

## Plan Compliance
- [x] All architect plan steps implemented(Step 1-6 全執行,含無 cookie 對照組與清理)
- [x] Implementation matches plan intent(補件驗證,無程式碼修改、無 contract 變更)
- [x] No unauthorised scope additions(僅新增 points_api_manual.md,為計畫產出物)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| (無 🟡 項目,無往返) | — | — |
