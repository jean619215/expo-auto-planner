# 點數 API 手動驗證 Checklist

> 對象:`/api/points/balance`(GET)、`/api/points/checkout`(POST)、`/api/points/webhook/mock`(POST, public)
> 驗證方式:fetch 腳本對 local dev server(`npm run dev`,接真雲端 Supabase)實測;查核用 service_role;登入用 Playwright 測試帳號(`.env.playwright.local`)。
> 首次執行:2026-07-17,18/18 + production 守門探測 全數通過。

## GET /api/points/balance
- [x] 未登入 → 401 `請先登入`
- [x] 登入 → 200,`balance` = 該帳號 ledger delta 總和(service_role 平行查核一致)
- [x] `transactions` ≤ 20 筆、created_at 降冪

## POST /api/points/checkout
- [x] 未登入 → 401
- [x] body 非 JSON → 400 `請求格式錯誤`
- [x] packageId 非字串 → 400 `無效的點數方案`
- [x] packageId 查無方案 → 400 `無效的點數方案`
- [x] packageId=basic(body 夾帶偽造 amountTwd/points)→ 200 `{orderId, redirectUrl}`;訂單為 server 端定價快照(amount_twd=100、points=100、pending、provider=mock、user_id 正確)— client 傳入值被忽略

## POST /api/points/webhook/mock(public 路由,簽章唯一守門)
- [x] 壞簽章 → 400 `invalid webhook`,訂單仍 pending、無發點
- [x] body 非 JSON → 400
- [x] 簽章正確但 orderId 不存在 → 400 同訊息(不洩漏訂單存在性)
- [x] 正確簽章 → 200;ledger 出現 `order:{id}` 一筆 +points;訂單 paid + provider_txn_id + paid_at
- [x] 同 payload 重送 → 200 且 ledger 仍只一筆(ref_id unique 冪等)
- [x] 全程未帶 cookie(public allowlist 生效);對照組:無 cookie 打 `/api/points/balance` → 401

## production 守門
- [x] `NODE_ENV=production` 且 `MOCK_PAYMENT_SECRET` 未設 → `getPaymentProvider()` throw
      (跑法:`NODE_ENV=production MOCK_PAYMENT_SECRET= node --experimental-strip-types -e "import('./src/lib/points/provider.ts').then(m => m.getPaymentProvider())"` 應噴錯)

## 重跑指引
- webhook 簽章:HMAC-SHA256(`{orderId}|{txnId}`,secret 同 `MOCK_PAYMENT_SECRET` 或 dev 預設值)。
- 測試產生的訂單與發點務必以 service_role 刪除(`point_transactions.ref_id = order:{orderId}` 與 `point_orders.id`),不留殘料。
