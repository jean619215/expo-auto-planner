# QA Report — 會員點數系統與商店頁 / Task 3(最後 task):[FRONTEND] 商店頁 + mock 結帳頁 + Header 連結 + Playwright
> Generated: 2026-07-17T10:10:00+08:00 | QA iteration: 1
> 性質:補件驗證(commit 5c6c7d7 既有實作;review 兩項🟡已由 implement 修畢,工作樹未 commit)。

## Summary
- Tests executed: 10 (`points-shop.spec.ts`,實跑兩輪確認穩定,非採信 review 報告文字)
- Passed: 10
- Failed: 0
- Blocked: 0

## Recommendation
**APPROVED** — AC1-AC5 全覆蓋,review 兩項🟡確認已修復,architect Step 2 的 2 個缺口候選判定為「可接受、不阻擋」(理由見下)。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| AC1 路由保護:未登入 `/shop` → `/login`;balance/checkout API 401 | ✅ PASS | spec 3 測試(access control describe),實跑綠。靜態核對 `src/proxy.ts` `/shop`、`/shop/:path*` 同時在 `PROTECTED_PAGES` 與 `config.matcher` 字面陣列。 |
| AC2 商店頁(登入):餘額/骨架/錯誤態、三方案卡、交易記錄、401→unauthenticated 態 | ✅ PASS | balance/packages 測試涵蓋餘額數字≥50、三卡 visible+enabled、交易列表含「註冊禮」。骨架/錯誤/unauthenticated 態無自動測試 — 見下方缺口判定,靜態核對程式碼邏輯正確。 |
| AC3 購買流程端到端(真 webhook 路徑) | ✅ PASS | end-to-end 測試:checkout→mock-checkout URL→模擬付款→`/shop?paid=1`→`shop-paid-success`→餘額+100→交易列表含「購買點數」。取消流程另有測試(不扣款)。購買中 disabled/文案無自動測試 — 見下方缺口判定。 |
| AC4 webhook 行為(重送冪等、竄改簽章) | ✅ PASS | 重送兩次皆 200、僅入帳一次(餘額 before+100,非 +200);竄改簽章 400 + 餘額不變。 |
| AC5 Playwright 驗收(本 task acceptance gate) | ✅ PASS | `npx playwright test points-shop` 10/10 passed,兩輪實跑(~32s/~37s),dev server 已就緒,單 worker 循序執行無競態。 |

## Edge Case / Header 連結新增測試 Results
| Case | Result | Notes |
|---|---|---|
| Header 未登入時 `header-nav-shop-link` 隱藏 | ✅ PASS | review 🟡-2 修復項,已納入 `points-shop.spec.ts` header navigation describe |
| Header 登入後連結可見且點擊導向 `/shop` | ✅ PASS | 同上,含 URL 斷言與 balance 可見斷言 |
| checkout 未知 packageId → 400 | ✅ PASS | |

## 缺口候選判定(architect-plan Step 2 / review 🟡 交付項)

### 1. Header 點數商店連結測試覆蓋(review 🟡-2)
**判定:已修復,非缺口。** 新增測試對「登出隱藏」「登入可見」「點擊導頁」三斷言點皆覆蓋,已納入 10 測試中並實測綠燈。

### 2. spec 憑證 fast-fail guard(review 🟡-1)
**判定:已修復,非缺口。** `points-shop.spec.ts:8-12` 在 import 後立即檢查 `PW_VERIFIED_EMAIL`/`PW_VERIFIED_PASSWORD`,缺失時 `throw new Error(...)` 帶明確中文訊息指向 `.env.playwright.local`。程式碼邏輯核對正確(if 未設 → throw,訊息可讀);未實跑「憑證缺失」情境本身(因不擬清空使用者真實的 `.env.playwright.local` 或以危險方式操作開發環境變數來驗證框架層級的同步 throw 分支),此為單純同步邏輯,程式碼審閱已足以確認正確性。

### 3. 載入骨架 / 錯誤狀態 / unauthenticated 頁面狀態無自動測試(architect Step 2 缺口候選)
**判定:可接受,不阻擋 sign-off(Low)。**
- 靜態核對 `src/app/shop/page.tsx`:`pageState` 為簡單 4 態有限狀態機(loading/ready/unauthenticated/error),loading 態渲染 `shop-balance-loading` 骨架、error 態渲染 `-` + `shop-load-error`(role=alert)、unauthenticated 態渲染 `shop-unauthenticated` + 登入連結,三態互斥且皆有 testid,邏輯直觀無分支耦合風險。
- unauthenticated 態部分已間接被覆蓋:access control 測試斷言未登入訪問 `/shop` 直接被 proxy redirect 到 `/login`,不會進入頁面組件的 unauthenticated 分支(該分支僅在極端情境如 session 於頁面停留期間過期時觸發,屬邊角)。
- loading/error 態屬純 UI 呈現(無業務邏輯、無資料寫入風險),與已測試的 ready 態共用同一段 fetch 邏輯,fetch 失敗與成功路徑用 try/catch + status check 明確分支,程式碼審閱信心高。
- 建議(非阻擋):未來若要補測試,可用 route mock/intercept 加一個 error 態案例即可涵蓋主要風險。記為技術債,不影響本次 sign-off。

### 4. 購買中(buyingId 非 null)按鈕全部 disabled + 當前鈕文案「前往付款…」無自動測試
**判定:可接受,不阻擋 sign-off(Low)。**
- 靜態核對 `src/app/shop/page.tsx`:`buyingId` 為單一 state,三顆按鈕 `disabled={buyingId !== null}` 共用同一條件,文案 `buyingId === pkg.id ? "前往付款…" : "購買"` 邏輯簡單、無 race window(`handleBuy` 開頭 `if (buyingId) return` guard 雙擊)。
- 此 UI 態存續時間極短(checkout API 呼叫到 `router.push` 之間,實測約 <1s),對「短暫中間態」做 Playwright 斷言易 flaky(需精準卡在時間窗口內斷言),與 review 💡-3(`balanceNumber()` 空字串邊角)風險等級相當,手動驗證比自動化划算。
- 已用程式碼審閱代替自動化:邏輯無缺陷。

## Regression Check
| Feature | Result | Notes |
|---|---|---|
| Header 既有連結(home/venue/profile/logout) | ✅ PASS(不受影響) | `HeaderPage.ts` 僅新增 `navShopLink` locator,未修改既有 locator 定義,不影響既有 spec 檔對 Header 的使用 |
| 既有其他 spec 檔(auth/venue-planner 等) | 未於本次 QA 範圍內執行 | 依 orchestrator-output.md AC5 與 architect-plan Step 5 分工:本次 QA 僅驗 `points-shop.spec.ts`,全套 8 支 spec 迴歸驗證屬 main thread playwright 關卡職責(story 收尾階段執行),非本輪 QA 重複項目 |

## Security Test
- Sensitive data exposure: **PASS** — 未見 token/session/密碼於畫面或回應內容中;spec 憑證讀自 `.env.playwright.local`(gitignored),未硬編碼於檔案內。
- Input validation: **PASS** — checkout 對未知 `packageId` 回 400(spec 覆蓋);webhook 對竄改簽章回 400 + 餘額不變(spec 覆蓋)。
- Auth boundary: **PASS** — 未登入 `/shop` 頁面/`balance`/`checkout` API 三處皆正確擋下(3 測試全綠),與 `src/proxy.ts` 靜態核對一致。

## Bugs Found
無。

## Test Coverage
- New code coverage: AC1-AC5 共 10/10 Playwright 測試綠燈(含本輪新增 header 連結測試),覆蓋 access control、balance/packages 顯示、端到端購買、取消不扣款、webhook 冪等/竄改拒絕、checkout 未知方案拒絕、Header 連結顯隱與導頁。
- Minimum required(AGENTS.md):FRONTEND 任務以 Playwright 為 acceptance gate,無強制覆蓋率百分比門檻。
- Status: **PASS**

## 附註:本輪 QA 執行方式
- Dev server 於背景執行,`curl localhost:3000/` 回 200 確認就緒後才起跑。
- `npx playwright test points-shop --reporter=list` 實跑兩輪(worker=1、fullyParallel=false,無並行競態),均 10/10 passed。
- 未採信 review-report.md 的文字結論,對兩項🟡的修復內容直接讀原始碼(`git diff` + `Read`)逐行核對後才判定「已修復」。
