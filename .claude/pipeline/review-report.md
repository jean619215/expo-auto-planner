# Code Review Report — 路由保護邏輯 (會員系統 Task 7)
> Generated: 2026-07-11T00:45:00Z | Review iteration: 1 | Reviewer: PR Reviewer agent
> Story: 會員系統 | Task 7 of 9 | Type: FRONTEND | Auth-adjacent: 依 AGENTS.md 以 Critical 最嚴標準審視

## Overall Assessment
APPROVED

## Summary
擴充 `src/proxy.ts` 為頁面層 auth gate(選項 A),實作與 architect plan 逐條一致:頁面分流 redirect、API 分支零行為變更、matcher 靜態字面值陣列。本 task 觸及 auth gate,依 AGENTS.md 以 🔴 Critical 最嚴標準逐項檢視 — 未發現任何 Critical 或 Should Fix 問題。lint / tsc / production build 全數通過。

## 審核逐項結論(最嚴標準)

### 1. API 行為零變更 ✅
- 頁面分支以 `!isApiRequest`(`pathname.startsWith("/api/")`)完全隔離;API 請求進入後走的仍是原本三段:allowlist 放行 → 無 user 401 JSON → 有 user 放行,順序與條件一字未變。
- 401 分支重構為 `withCookiesFrom(response, unauthorized)`:helper 內容(`base.cookies.getAll().forEach(c => target.cookies.set(c))`)是原 inline 程式碼的逐字抽取,`getAll()` 回傳的 cookie 物件含完整 options,`set(cookie)` 整包接受 — 行為等價,Set-Cookie 不遺失。
- API 請求永不收到 3xx(頁面分支先 return),前端 fetch 錯誤處理契約不變。

### 2. 頁面分流 / 真值表 ✅
逐格對照 architect plan 真值表驗證:
- 未登入 + `/profile`(含子路徑)→ 307 `/login` ✅
- 已登入 + `/login`、`/register`(含子路徑)→ 307 `/` ✅
- 未登入 + `/login`、`/register` → 放行(不屬 PROTECTED_PAGES)✅
- `/` 不在 matcher → proxy 不執行 ✅
- 無迴圈:兩個 redirect 目標(`/login` 未登入放行、`/` 不經 proxy)皆一跳收斂,不存在「目標再觸發 redirect」的組合。

### 3. Redirect 安全 ✅
- 目標僅 `LOGIN_PATH` / `HOME_PATH` 兩個模組內常數;`new URL(LOGIN_PATH, request.url)` 中 `request.url` 只提供 origin,路徑固定 — 無任何 query/header/body 使用者輸入影響目標 → **無 open redirect**。
- 兩個 redirect 分支皆經 `withCookiesFrom` 帶上 session 刷新 cookie。

### 4. matchesPage ✅
- 「等於 或 前綴 `p + "/"`」與 Next.js 官方文件 matcher anchoring 語義一致(已查 `node_modules/next/dist/docs/.../proxy.md` 第 130 行:`/about` matches `/about` and `/about/team`)。
- `/profile/xxx`:matcher 涵蓋 + matchesPage 命中 → fail-closed redirect ✅
- `/profilexyz`:matcher 以 path segment anchoring 不會匹配;即使進入,matchesPage 亦不誤中(非等於且不以 `/profile/` 開頭)✅

### 5. matcher ✅
- 靜態字面值陣列 `["/api/:path*", "/profile", "/login", "/register"]`,涵蓋 PROTECTED_PAGES + AUTH_PAGES 全部項目,兩處目前同步。
- 「必須靜態字面值、新增頁面需雙處同步」註解到位(matcher 上方 + 兩組常數旁)。
- `/`、`_next/*`、favicon、public 資產不在 matcher → 靜態資源零影響。

### 6. 其他 ✅
- 無任何 log 語句、不輸出 token/session/cookie。
- 未加 `runtime` config(Task 4 已知會 throw 的限制,遵守)。
- 無 scope 外改動:git diff 僅 `src/proxy.ts` 與 `supabase/tests/auth_routes_manual.md`(+pipeline 檔),`login/register/profile` 三個 page 檔皆未動,符合計畫。
- 驗證:`npm run lint` ✅、`npx tsc --noEmit` ✅、`npm run build` ✅(build 輸出確認 Proxy 已註冊、三頁面路由存在)。

### 7. 測試交付 ✅
- checklist 第 9 節 12 項:逐一對應 orchestrator 驗收條件(9.1 覆蓋全部真值表格子 + API 不變)與 edge cases(9.1-9:登出後回 /profile;9.2:迴圈/靜態資源/Set-Cookie/不 log 敏感)。
- 9.3 明確定義延後至 Task 9 合併跑的 playwright 情境清單,符合 orchestrator 決議。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: src/proxy.ts:17,77
- **Issue**: `PROTECTED_PAGES`/`AUTH_PAGES` 與 `config.matcher` 需手動雙處同步(Next.js 限制,matcher 不能引用變數)。漏改 matcher 的失效模式是「新頁面不受保護」。
- **Note**: 計畫已明列此為接受的已知限制並以並排註解緩解;checklist 9.1 第 1 條為每次新增後必測項。未來若引入 test runner,可用 `next/experimental/testing/server` 的 matcher 測試把同步關係鎖進測試。純記錄,無需行動。

### Suggestion 2
- **File**: (repo root) Design.pdf
- **Issue**: 工作目錄有 untracked 的 `Design.pdf`,非本 task 產物。
- **Note**: 提醒人類確認是否應納入 .gitignore,避免日後誤 commit。與本 task 無關。

## Security Assessment
- Secrets scan: PASS(無新增 key;僅經既有 `middleware.ts` factory,service_role 未進 proxy)
- Input validation: PASS(pathname 由 Next.js normalize;等於/前綴匹配,不解析使用者輸入)
- Auth/authz: PASS(fail-closed 不變;受保護頁子路徑預設 redirect;API 預設 401)
- Open redirect: PASS(目標為固定常數)
- Sensitive logging: PASS(無)
- CORS/CSP: 未觸及
- Test coverage: 手動 checklist 第 9 節 12 項(涵蓋全部驗收條件與 edge cases)+ playwright 情境清單(依決議延後與 Task 9 合併跑)

## Plan Compliance
- [x] All architect plan steps implemented(常數/helper/分流/matcher/checklist 第 9 節,與計畫程式碼逐行一致)
- [x] Implementation matches plan intent(選項 A、API 零變更、頁面檔零改動)
- [x] No unauthorised scope additions

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| (無 — 本輪無 Should Fix 需開發者處理) | — | — |
