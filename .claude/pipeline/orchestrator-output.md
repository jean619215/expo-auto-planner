# Orchestrator Output — 建立全站導覽 Header 元件

> Story: 全站導覽 Header 與個人資料編輯模式 | Task 1 of 2 | Generated: 2026-07-15T00:00:00+08:00

## Task Type
FRONTEND

## Refined Requirement
新增一個全站共用的 Header 元件,掛載在 `src/app/layout.tsx`(RootLayout)的 `<body>` 內、`{children}` 之上,讓所有頁面(首頁、登入、註冊、個人資料、場地產生器)都能看到同一個固定導覽列。

Header 採用「一個 slim 水平長條」的版面風格(不是 `AuthNav.tsx` 現有的置中大型 pill-button CTA 樣式),內容由左到右分為三段(user 已於 Q&A 確認此順序):

1. **左側**:站名/首頁連結(例如「展覽自動排程」文字或簡短 logo),點擊導向 `/`。
2. **中間**:導覽連結,依序為「個人資訊」(`/profile`)、「場地產生器」(`/venue`)——以純文字連結呈現,非 pill 按鈕。**這兩個連結只在已登入時渲染**;未登入時完全不顯示(不是顯示後靠 `proxy.ts` redirect,是直接不出現在 DOM 中)。
3. **右側**:登入狀態對應的操作——復用 `AuthNav.tsx` 既有的登入狀態偵測邏輯(`GET /api/profile`,200=loggedIn / 401=loggedOut)與登出邏輯(`logoutRequest()` 呼叫 + `router.refresh()`)。未登入顯示「登入」「註冊」連結;已登入顯示「個人資訊」入口與「登出」按鈕。

新元件不得直接複製貼上 `AuthNav.tsx` 的 pill-button class,而要用符合水平長條版面的樣式(文字連結 + 少量強調樣式),但沿用專案既有的顏色/dark-mode token(`text-black dark:text-zinc-50`、`text-zinc-600 dark:text-zinc-400`、`border-black/12 dark:border-white/18` 等既有慣例色階),維持視覺一致性,只是版面(layout)不同,不是換一套色系。

登入狀態偵測邏輯本身(fetch `/api/profile`、loading/loggedIn/loggedOut 三態、登出流程)必須複用,不得重新實作一份平行邏輯——具體實作方式(抽成 hook、共用元件內部 state,或其他重構手法)由架構師決定,本規格只鎖定「行為必須一致、不得重寫偵測邏輯」這個產品層面的要求。

首頁(`src/app/page.tsx`)現有置中的 `<AuthNav />` 區塊要移除,首頁內容簡化為只剩標題(`展覽自動排程`)與說明文字,不再自行渲染登入/註冊/個人資料/登出按鈕——因為新 Header 已經全站涵蓋這些操作,保留會造成畫面上出現兩組重複的登入/註冊按鈕。

## Clarified Acceptance Criteria
- [ ] Given 使用者造訪任何頁面(首頁、登入頁、註冊頁、個人資料頁、場地產生器頁),when 頁面載入完成,then 畫面上方顯示固定的 Header,且 Header 在所有頁面間版面一致。
- [ ] Given Header 已渲染,when 使用者查看左側,then 看到站名/首頁連結,點擊後導向 `/`。
- [ ] Given 使用者已登入,when 查看 Header 中間區塊,then 看到「個人資訊」與「場地產生器」文字連結,點擊分別導向 `/profile`、`/venue`。
- [ ] Given 使用者未登入,when 查看 Header 中間區塊,then 「個人資訊」與「場地產生器」連結不顯示(DOM 中不存在,而非顯示但 disabled)。
- [ ] Given 使用者未登入,when 查看 Header 右側,then 看到「登入」「註冊」連結,點擊分別導向 `/login`、`/register`。
- [ ] Given 使用者已登入,when 查看 Header 右側,then 看到「個人資訊」入口與「登出」按鈕(登入狀態的呈現細節與現有 `AuthNav.tsx` 已登入分支一致,例如登出中文案「登出中…」與 disabled 狀態)。
- [ ] Given 使用者已登入且點擊 Header 的「登出」,when 登出請求成功,then 狀態切換回未登入(中間導覽連結消失、右側變回登入/註冊),且不需整頁重新整理即可反映(維持 `AuthNav.tsx` 現有的 `router.refresh()` 行為)。
- [ ] Given Header 正在偵測登入狀態(尚未收到 `/api/profile` 回應),when 使用者查看畫面,then 顯示 loading 狀態(不得閃爍顯示錯誤的登入/未登入 UI 後又切換,維持現有 `AuthNav.tsx` 的 loading skeleton 慣例)。
- [ ] Given 首頁載入,when 使用者查看畫面,then 只看到標題與說明文字,不再看到重複的登入/註冊/個人資料/登出按鈕(這些操作已在全站 Header 提供)。
- [ ] Given 使用者在受保護頁面(`/profile`)或未登入時嘗試直接輸入 `/profile` 網址,then 既有 `proxy.ts` 的頁面保護 redirect 行為不受影響(Header 本身不修改 `proxy.ts` 邏輯,只是消費登入狀態做顯示判斷)。

## Edge Cases to Handle
- 登入狀態偵測尚未完成(loading)時,中間導覽連結(個人資訊/場地產生器)不應該提前顯示或提前隱藏造成畫面跳動——loading 態下不顯示這兩個連結,等狀態確定為 loggedIn 才顯示,與右側 loading skeleton 的處理精神一致。
- 使用者在其他分頁登出(或 session 過期)後,回到已開啟分頁操作:Header 目前只在掛載時偵測一次登入狀態(沿用 `AuthNav.tsx` 現有行為,不做輪詢或跨分頁同步),此為既有已知限制,非本任務範圍要修正的行為。
- 視窗寬度縮小(手機尺寸):Header 三段式版面需可讀、不重疊;文字連結可換行或適度縮小間距,但不要求做出漢堡選單(見「Out of Scope」)。
- 使用者已登入但暱稱/個人資料尚未設定:與本任務無關,Header 不需顯示暱稱,只需文字連結「個人資訊」與登出按鈕。
- login/register 頁面在已登入狀態下短暫可見(`proxy.ts` redirect 生效前的畫面閃現):Header 仍應正常渲染已登入狀態,不因該頁面即將被導頁而顯示錯誤/未登入態。

## Error States
- `GET /api/profile` 請求失敗(網路錯誤、逾時、非 401 的其他錯誤狀態碼):比照 `AuthNav.tsx` 現有 `.catch()` 行為,視同未登入(`loggedOut`),不顯示錯誤訊息、不阻塞頁面渲染。
- 登出請求(`logoutRequest()`)失敗:比照 `AuthNav.tsx` 現有行為——`finally` 區塊解除 `loggingOut` 狀態,允許重試;本任務不新增額外的錯誤訊息 UI(如需改善,超出本任務範圍)。

## Out of Scope
- 手機版漢堡選單/收合導覽(本任務只要求水平長條在窄螢幕下不破版,不要求做出收合互動)。
- 個人資料頁的檢視/編輯模式切換(此為同故事的 Task 2,獨立處理)。
- 登入狀態的跨分頁即時同步或輪詢偵測(維持 `AuthNav.tsx` 現有的「掛載時偵測一次」行為)。
- 修改 `src/proxy.ts` 的頁面保護/redirect 邏輯(Header 只是消費既有的登入狀態,不改變路由保護規則)。
- 新增任何新頁面或新路由(所有連結都指向 `proxy.ts` 已知的既有路徑:`/`、`/profile`、`/venue`、`/login`、`/register`)。
- 是否保留、移除或重構 `AuthNav.tsx` 本身(是否讓 Header 直接複用/包裝 `AuthNav`,或抽出共用 hook,由架構師決定技術方案;產品規格只要求「行為一致、不重寫偵測邏輯」)。
- Header 的 SEO/meta 相關調整。

## Assumptions Made
- 「個人資訊」在 Header 中間導覽與右側已登入操作中,產品意圖是同一個目的地(`/profile`),不需要是兩個視覺上分開、文案不同的入口;實際是否合併為一個連結或保留兩個入口點,留給架構師/開發者依版面美觀判斷,只要不違反「已登入時個人資訊必須可達」與「未登入時中間導覽連結不顯示」兩條驗收條件。
- 站名/首頁連結的確切文案沿用現有 `metadata.title`「展覽自動排程」,不引入新的 logo 圖片資產(專案目前無 logo 圖檔)。
- 「場地產生器」連結文案直接對應 `/venue` 路由,沿用故事描述中的既有稱呼;若架構師/開發者在 `src/app/venue/page.tsx` 發現既有標題用語不同,以既有頁面標題用語為準,保持全站命名一致。
- 本任務不要求新增 Playwright 測試涵蓋所有既有頁面(login/register/venue)的全新快照,但既有 Playwright 套件若因新增 Header 導致選擇器衝突(例如既有測試依賴首頁的 `<AuthNav />` DOM 結構或位置),需要同步修正——此為實作/測試階段常規維護,非新增範圍外功能。
- 五項確認皆由使用者於 Q&A 中明確採用建議預設值(順序、隱藏而非顯示後跳轉、移除首頁重複 AuthNav、水平長條文字連結風格、FRONTEND 任務類型),視為已鎖定,非待確認事項。

## Security Notes
- Header 不新增任何 API 呼叫或資料存取邏輯,純粹消費既有 `GET /api/profile`(已受 `proxy.ts` 保護)與既有 `logoutRequest()`(呼叫既有的 `/api/auth/logout`)——不涉及新的認證/授權面。
- 中間導覽連結(個人資訊/場地產生器)的顯示/隱藏是前端 UX 層面的呈現邏輯,**不是安全邊界**——真正的存取控制仍由 `src/proxy.ts` 的 `PROTECTED_PAGES` 頁面保護把關(未登入直接輸入 `/profile` 網址仍會被導向 `/login`)。本任務不應被誤解為「隱藏連結=足夠的存取控制」。
- 未發現需要新增或修改的 secrets/tokens/連線字串處理;不涉及 auth/session/`DATABASE_URL` 變更,依 AGENTS.md 標準本任務本身不屬於自動 🔴 Critical 類別,但 PR Reviewer 仍應確認 Header 未意外引入直接呼叫 Supabase client 或繞過 `/api/*` 的行為。
