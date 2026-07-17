# Orchestrator Output — 會員點數系統與商店頁 / Task 3(最後 task)

> Story: stories/points-system.md
> Task 3 of 3: [FRONTEND] 商店頁 + mock 結帳頁 + Header 連結 + Playwright
> Task type: **FRONTEND**
> 性質: **補件驗證** — 實作與 Playwright 測試已存在(commit 5c6c7d7:points-shop.spec.ts 9 測試、ShopPage.ts)。驗證為主,缺口才修。
> 澄清修正:story 原寫「Header 顯示點數餘額」與實作不符 — 實作為 Header「點數商店」連結(登入時顯示),餘額顯示在商店頁。story 檔已修正對齊。

## Clarified Acceptance Criteria

### AC1 — 路由保護
- 未登入訪 `/shop` → redirect `/login`(proxy.ts:PROTECTED_PAGES + matcher 皆已含 `/shop`、`/shop/:path*`)。
- balance/checkout API 未登入 401(proxy + route 雙層)。

### AC2 — 商店頁(登入)
- 顯示點數餘額(`shop-balance`,載入中骨架 `shop-balance-loading`,錯誤顯示 `-` + `shop-load-error` role=alert)。
- 三方案卡(`shop-package-{basic|plus|mega}`)含點數/贈點/價格與購買鈕(`shop-buy-{id}`)。
- 交易記錄列表(`shop-transactions`):reason 中文標籤(註冊禮/購買點數)、時間、±delta 上色。
- API 401 時頁面轉 `shop-unauthenticated` 狀態(含登入連結)。

### AC3 — 購買流程(端到端,走真 webhook 路徑)
- 點購買 → POST checkout → router.push mock 結帳頁(`/shop/mock-checkout?orderId&txnId&sig&…`)。
- 購買中:全部購買鈕 disabled、當前鈕文案「前往付款…」;失敗顯示 `shop-buy-error` role=alert。
- mock 結帳頁:顯示方案名/點數/金額(`mock-checkout-*` testids);「模擬付款」按鈕打真 webhook(簽章驗證路徑)成功後導回 `/shop?paid=1`;「取消」返回 `/shop` 不扣款。
- `/shop?paid=1` 顯示 `shop-paid-success` role=status,餘額 +100(basic)。

### AC4 — webhook 行為(spec 內 API-level 測試)
- 同 payload 重送兩次:200 + 只入帳一次。
- 竄改簽章:400 + 餘額不變。

### AC5 — Playwright 驗收(本 task 的 acceptance gate)
- `points-shop.spec.ts` 9 測試全綠(access control 3 + balance/packages 1 + purchase flow 5),page-object 模式(ShopPage.ts),對 live dev server + 真雲端 Supabase。
- 全套既有 spec 檔不因本 story 迴歸(story 完成時全套跑)。

## 驗證方式
- playwright 階段:乾淨 dev server 跑 points-shop.spec.ts,story 收尾跑全套 8 支 spec。
- review:UI 程式碼規範(shadcn 元件、@/* alias、frontend 不直呼 Supabase、testid 覆蓋)。

## Out of Scope
- 真金流(ECPay)接入、pending 訂單清理(review 💡 已記錄)。

## Assumptions
1. 既有 9 測試視為 spec 起點;QA 若發現 AC 未覆蓋項,補測試而非改功能。
2. 本 task 完成 = story 完成:story 檔 3 checkbox 全勾 + Notion story 列標已完成。
