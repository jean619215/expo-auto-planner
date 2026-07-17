# Code Review Report — 會員點數系統與商店頁 / Task 3 [FRONTEND] 商店頁 + mock 結帳頁 + Header 連結 + Playwright
> Generated: 2026-07-17T09:40:00+08:00 | Review iteration: 1
> 性質:補件驗證(實作已在 commit 5c6c7d7),review 對象為既有前端程式碼 + Playwright spec。

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
前端實作品質良好:UI 狀態機完整(loading/ready/error/unauthenticated)、race 防護到位(useEffect cleanup flag、雙重點擊 guard)、全走 `/api/*`、shadcn 元件、`@/*` alias、無硬編碼秘密。mock 結帳頁的安全性論證成立(見 Security Assessment)。發現 2 個 🟡(spec 憑證缺 fast-fail、Header 連結無測試覆蓋)與 4 個 💡,無 🔴。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — spec 憑證缺 fast-fail 防護
- **File**: `playwright-tests/points-shop.spec.ts:7-8`
- **Issue**: `process.env.PW_VERIFIED_EMAIL!` / `PW_VERIFIED_PASSWORD!` 用 non-null assertion 但無執行期檢查。`.env.playwright.local` 不存在時(新機器/CI),`undefined` 會被當字串填進登入表單,9 個測試以難以診斷的登入失敗炸掉,而非清楚的設定錯誤。
- **Suggested fix**: 檔案頂部加 guard:任一變數缺失時 `throw new Error("缺少 PW_VERIFIED_EMAIL/PW_VERIFIED_PASSWORD — 請設定 .env.playwright.local")`(或 `test.skip` 帶訊息)。若其他既有 spec 有相同模式,一併統一。

### Issue 2 — Header 點數商店連結無測試覆蓋
- **File**: `playwright-tests/points-shop.spec.ts`(缺測);實作在 `src/components/Header.tsx`(`header-nav-shop-link`)
- **Issue**: orchestrator 澄清後「Header 登入時顯示點數商店連結」是本 task 交付項之一,但 9 個測試全部直接 `goto("/shop")`,使用者實際的入口路徑(Header 連結)完全未驗證。連結壞掉(href 打錯、條件渲染錯)測試仍全綠。
- **Suggested fix**: 加一測試:登入後斷言 `header-nav-shop-link` 可見、點擊後 URL 為 `/shop`;未登入斷言不可見。交 QA 階段一併判定(與 architect-plan Step 2 缺口候選同機制)。

## 💡 Suggestions (Consider — No Action Required)

1. **`/shop?paid=1` banner 在重新整理後仍顯示** (`src/app/shop/page.tsx:48,133`) — query param 不會消失,使用者 reload 會再看到「付款成功」。可用 `router.replace("/shop")` 在顯示後清掉 param。純 UX,不影響正確性(banner 不代表再次入帳)。
2. **mock-checkout 顯示欄位取自未簽章的 URL params** (`src/app/shop/mock-checkout/page.tsx:30-32`) — `amount/points/name` 可被使用者改 URL 竄改,但僅影響「顯示」;實際入帳點數由 webhook 端以 orderId 查 server 端定價快照決定(checkout route 註解已明示不信任 client)。React 自動 escape,無 XSS。真金流換裝時此頁整個被取代 — 僅記錄。
3. **`ShopPage.balanceNumber()` 對空字串回傳 0** (`playwright-tests/pages/ShopPage.ts:39-42`) — `Number("") === 0`,理論上可能把「尚未渲染」誤讀為餘額 0。實務上所有呼叫點前都先 `expect(balance).toBeVisible()`,且 error 態顯示 `-` 得 NaN 會明確失敗,風險極低。可改為 text 為空時 throw。
4. **error 態下購買鈕仍可點** (`src/app/shop/page.tsx:164,197-204`) — balance 載入失敗不阻擋 checkout(兩者是獨立 API),行為合理;僅提醒此為有意設計而非遺漏。

## Security Assessment
- Secrets scan: **PASS** — 無硬編碼憑證。spec 憑證走 `.env.playwright.local`(gitignored,符合 AGENTS.md)。`MOCK_SECRET` 的 dev 預設值不是真實系統憑證,且 `getPaymentProvider()` 有 production 守門(NODE_ENV=production 且未設 `MOCK_PAYMENT_SECRET` 直接 throw)。
- Input validation: **PASS** — checkout route 對 body/packageId 逐層驗證;mock-checkout 頁對缺參數顯示錯誤而非壞掉;webhook 端 `verifyWebhook` 型別 + HMAC(timingSafeEqual)驗證。
- Auth/authz: **PASS** — `/shop` 在 `PROTECTED_PAGES` + `config.matcher`(`/shop`、`/shop/:path*` 靜態字面值)雙處,mock-checkout 子路徑也受保護。API 側 proxy fail-closed + route 內 `getUser()` 雙層 401。
- **mock 結帳頁安全性論證(重點審項):成立。** 簽章素材(orderId/txnId/sig)經 URL 繞回 webhook 看似把簽好的東西暴露給瀏覽器,但:(a) 這是刻意模擬「金流商付款頁 → server-to-server 通知」的路徑,簽章由扮演金流商後台的本端先簽好,前端只是搬運,不是前端直接加點捷徑(provider.ts:47-48、mock-checkout 頁頂註解均有交代);(b) 重放已由 ref_id idempotency 擋住(spec 有測,兩次 200 只入帳一次);(c) 竄改由 HMAC 擋住(spec 有測,400 + 餘額不變);(d) production 未明確設 secret 無法啟用 mock;(e) 真金流換裝時此頁整個被取代,不留攻擊面。無 🔴。
- Test coverage: 9/9 測試對應 AC1-AC4(access control 3 + balance/packages 1 + purchase flow 5);缺口見 🟡-2 及 architect-plan Step 2 已標的 2 個可接受候選(載入骨架/購買中 disabled 文案)。
- 無 CORS/CSP 修改、無新相依、無 log 洩漏。

## Spec 品質(flaky 風險)
- `playwright.config.ts` `workers: 1` + `fullyParallel: false` → 同帳號的 balance 斷言無 test 間競態(before + 100 這類相對斷言因序列執行而安全)。
- 等待邏輯全用 auto-retry assertion(`toBeVisible`/`toHaveText`/`toHaveURL`),無 sleep/waitForTimeout;`balanceNumber()` 呼叫前均先斷言 balance 可見(loading 骨架用不同 testid,不會誤讀)。
- webhook 重送/竄改測試用 `page.request`(共享登入 context)直打 API,再 navigate 後以 auto-retry 斷言餘額 — 無隱式競態。
- Page object 模式與既有 `pages/` 一致(testid locator + 動作方法),mock-checkout 元素併入 ShopPage 合理(檔頭有註明涵蓋範圍)。

## Plan Compliance
- [x] All architect plan steps implemented(Step 1 靜態核對、Step 2 覆蓋度映射均獨立複核,結論一致)
- [x] Implementation matches plan intent(補件驗證,無程式碼修改)
- [x] No unauthorised scope additions

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡-1 spec 憑證 fast-fail | 待 developer 處理 | 交回 pipeline auto-resolve(不阻擋 review 通過) |
| 🟡-2 Header 連結測試 | 待 QA 判定是否補測 | 交 QA 階段(與 architect 缺口候選同機制) |
