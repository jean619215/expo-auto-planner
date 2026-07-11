# Architect Plan — 路由保護邏輯 (Task 7)

> Story: 會員系統 | Task 7 of 9 | Task type: FRONTEND | Generated: 2026-07-10T13:30:00Z

## Overview

擴充既有的 `src/proxy.ts`(選項 A):matcher 加入三個頁面路徑,對「頁面請求」做 server 端 redirect,對「API 請求」維持既有 401 JSON 行為完全不變。login/register 頁面本身零改動。

## Task Type Confirmed

FRONTEND(實作載體是 proxy,但交付物是前端路由行為;無新 API、無 schema 變更)

## 選項定案:A(擴充 proxy)

依 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` 確認,選項 A 無障礙:

1. **matcher 多路徑**:官方支援常數字串陣列 `matcher: ['/api/:path*', '/profile', ...]`。注意文件明言 matcher 值必須是**可靜態分析的常數**,變數會被忽略 — 所以 matcher 陣列須手寫字面值,不能由 `PROTECTED_PAGES` 常數展開。
2. **redirect 用法**:`NextResponse.redirect(new URL('/login', request.url))`,官方範例即此寫法(預設 307,對頁面導向正確)。
3. **頁面 vs API 區分**:以 `request.nextUrl.pathname.startsWith('/api/')` 區分即可 — pathname 已由 Next.js normalize,與 Task 4 既有作法一致。
4. **matcher anchoring**:文件第 5 點 — `/profile` 會同時匹配 `/profile` 與 `/profile/team`(anchored to start)。因此程式內判斷須用「等於或前綴 + /」邏輯,子路徑才維持 fail-closed。
5. Task 4 已確認的限制不變:檔名 `proxy.ts`、函式名 `proxy`、不可加 `runtime` config(會 throw)。

選項 A 優點成立:單點集中、server 端 3xx 無閃爍、與既有 fail-closed 精神一致、頁面元件零改動。選項 B 不採用(client 端閃爍、每頁自理易漏)。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| (無) | 不新建檔案 |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `/Users/jeanchung/expo-auto-planner/src/proxy.ts` | 加 `PROTECTED_PAGES`、`AUTH_PAGES` 常數;matcher 改為陣列加入 `/profile`、`/login`、`/register`;`proxy()` 內加頁面分支(redirect),API 分支邏輯不動 |
| `/Users/jeanchung/expo-auto-planner/supabase/tests/auth_routes_manual.md` | 追加「第 9 節:路由保護手動驗收 checklist」 |

`src/app/login/page.tsx`、`src/app/register/page.tsx`、`src/app/profile/page.tsx` **皆不修改**(見 Architecture Notes)。

## Implementation Steps

1. **`src/proxy.ts` — 常數設計**(放在 `PUBLIC_API_PATHS` 旁,同風格):

   ```ts
   // 未登入不可見的頁面。新增受保護頁面: 加到這裡 + 加到下方 config.matcher。
   const PROTECTED_PAGES = ["/profile"];
   // 已登入不該再看的頁面 (導回首頁)。新增時同樣要同步 config.matcher。
   const AUTH_PAGES = ["/login", "/register"];
   const LOGIN_PATH = "/login"; // redirect 目標為固定常數 — 不取自 query/header,無 open redirect
   const HOME_PATH = "/";
   ```

   加一個小 helper(等於或前綴匹配,對齊 matcher 的 anchoring 語義,子路徑 fail-closed):

   ```ts
   function matchesPage(pathname: string, pages: string[]): boolean {
     return pages.some((p) => pathname === p || pathname.startsWith(p + "/"));
   }
   ```

2. **`src/proxy.ts` — `proxy()` 主體**:保留開頭 `updateSession(request)` 與 `pathname` 取得不動。在 `PUBLIC_API_PATHS` 檢查**之前**,先做頁面/API 分流:

   ```ts
   const isApiRequest = pathname.startsWith("/api/");

   if (!isApiRequest) {
     if (!user && matchesPage(pathname, PROTECTED_PAGES)) {
       return redirectWithCookies(new URL(LOGIN_PATH, request.url), response);
     }
     if (user && matchesPage(pathname, AUTH_PAGES)) {
       return redirectWithCookies(new URL(HOME_PATH, request.url), response);
     }
     return response; // 其他頁面 (matcher 內但不符合上述) 放行
   }
   // ↓ 以下 API 分支 = 既有程式碼,一行都不改
   ```

   其中 `redirectWithCookies` 是抽出的小 helper:建立 `NextResponse.redirect(url)` 後,把 `response.cookies.getAll()` 逐一 set 到 redirect response 上 — 與既有 401 分支相同的 cookie 轉移模式(session refresh 的 Set-Cookie 不可丟失)。既有 401 分支可順手改用同一 helper 消重複,但行為不得改變。

3. **`src/proxy.ts` — matcher**(文件要求字面常數,不能引用變數;加註解提醒與 `PROTECTED_PAGES`/`AUTH_PAGES` 手動同步):

   ```ts
   export const config = {
     // 注意: matcher 必須是靜態字面值 (Next.js build 時分析,變數會被忽略)。
     // 新增受保護/auth 頁面時,需同步修改上方常數與這裡。
     matcher: ["/api/:path*", "/profile", "/login", "/register"],
   };
   ```

   `/`(首頁)與 `_next/static`、`_next/image`、`favicon.ico`、`public/` 資產都不在 matcher 內 → proxy 完全不被觸發,靜態資源零影響(比負向 regex 排除法更安全簡單)。

4. **`supabase/tests/auth_routes_manual.md`** — 追加第 9 節手動 checklist(內容見 Test Plan)。

5. **驗證**:`npm run lint`、`npx tsc --noEmit`、`npm run build` 全過。dev server 起來後至少手動抽驗「未登入開 /profile → URL 變 /login」與「未登入打 /api/profile → 仍 401 JSON」兩條,確認分流正確。

## Data Flow

```
Browser request
  └─ proxy.ts (matcher: /api/:path*, /profile, /login, /register)
       ├─ updateSession(request) → { response(帶 refresh cookie), user }
       ├─ pathname 以 /api/ 開頭?
       │    ├─ 是 → 既有邏輯: 公開 allowlist 放行 / 無 user 401 JSON / 有 user 放行
       │    └─ 否 (頁面請求)
       │         ├─ 無 user 且屬 PROTECTED_PAGES → 307 redirect /login (帶 cookie)
       │         ├─ 有 user 且屬 AUTH_PAGES     → 307 redirect / (帶 cookie)
       │         └─ 其餘 → 放行 (回 response)
       └─ 未列入 matcher 的路徑 (/、_next/*、favicon…) → proxy 不執行
```

## Redirect 迴圈防護分析

redirect 目標只有兩個固定常數:`/login` 與 `/`。

- `/login` 未登入時**放行**(不屬 PROTECTED_PAGES)→ 「未登入 /profile → /login」到此收斂,一跳結束。
- `/` 不在 matcher 內,proxy 根本不執行 → 「已登入 /login → /」一跳結束。
- 不存在任何「redirect 目標本身又觸發 redirect」的組合。

真值表(每路徑 × 登入狀態 → 行為):

| 路徑 | 未登入 | 已登入 |
| ---- | ------ | ------ |
| `/profile`(及子路徑) | 307 → `/login` | 放行,正常顯示 |
| `/login`(及子路徑) | 放行 | 307 → `/` |
| `/register`(及子路徑) | 放行 | 307 → `/` |
| `/` | 不經 proxy,放行 | 不經 proxy,放行 |
| `/api/auth/*`(allowlist 四條) | 放行 | 放行 |
| `/api/*` 其他(如 `/api/profile`) | 401 JSON(不 redirect) | 放行 |
| `_next/*`、favicon、public 資產 | 不經 proxy | 不經 proxy |

每格終點都是「放行」或「一跳到放行格」→ 無迴圈。

補充:登入成功後 `login/page.tsx` 的 `router.push("/") + router.refresh()` 不受影響(目標 `/` 不經 proxy);Next `<Link>` 對 `/profile` 的 prefetch 在未登入時會拿到 307,Next 於實際導航時處理,無害。

## /profile 頁內 401 fallback:保留

`profile/page.tsx` 的 `unauthenticated` 狀態(「請先登入 → 前往登入」)**保留不動**,理由:

1. **Defense in depth**:與 API 層「proxy 401 + route handler 自帶 getUser()」的雙層模式一致。proxy 是唯一 redirect 點,若未來 matcher 手滑改壞或部署平台 proxy 行為異常,頁面仍不會裸露且給使用者出路。
2. **覆蓋 proxy 管不到的時序**:使用者停在已載入的 /profile 頁,session 在瀏覽期間過期/於他分頁登出,此時無新頁面請求經過 proxy;下一次 fetch `/api/profile` 拿 401,頁內 fallback 是唯一接手者(PATCH 401 分支同理)。
3. 零成本:不改即保留,無新增維護負擔。

## Test Plan

驗收方式依 orchestrator 決議:**Task 7/8/9 完成後一次手動驗收;playwright 延後與 Task 9 合併跑**。本 task QA 為靜態驗收 + checklist 交付,playwright 欠帳記 task-log。

### 交付 1:手動測試 checklist(追加至 `supabase/tests/auth_routes_manual.md` 第 9 節)

前置:dev server 運行、一組已確認 email 的測試帳號。

1. [ ] 無痕視窗(未登入)直接開 `/profile` → URL 變為 `/login`,顯示登入頁,profile 內容完全沒出現
2. [ ] 未登入開 `/login` → 正常顯示登入頁(無 redirect)
3. [ ] 未登入開 `/register` → 正常顯示註冊頁
4. [ ] 未登入開 `/` → 正常顯示首頁
5. [ ] 登入後開 `/profile` → 正常顯示個人資料
6. [ ] 登入狀態直接開 `/login` → URL 變為 `/`
7. [ ] 登入狀態直接開 `/register` → URL 變為 `/`
8. [ ] 未登入以 Insomnia 打 `GET /api/profile` → 401 JSON `{"error":"請先登入"}`(非 3xx redirect)
9. [ ] 登入 → 登出 → 瀏覽器上一頁/重新整理回到 `/profile` → 導向 `/login`
10. [ ] DevTools Network:redirect 為 307,無連續多次 redirect(無迴圈);`_next/static`、favicon 均 200 正常載入
11. [ ] DevTools Network:redirect response 上若有 Set-Cookie(session refresh)未遺失
12. [ ] Console / server log 無 token、session、cookie 值輸出

### 交付 2:延後合併 playwright 的情境清單(Task 9 後一次跑)

- 未登入 goto `/profile` → 斷言 URL 為 `/login` 且看得到登入表單
- 登入流程走完 → goto `/login` → 斷言 URL 為 `/`;goto `/register` → 斷言 URL 為 `/`
- 登入後 goto `/profile` → 斷言個人資料表單可見
- 未登入 goto `/`、`/login`、`/register` → 皆正常渲染
- API 檢查:未登入 request context 打 `/api/profile` → status 401、body 為 JSON
- 登出後 reload `/profile` → 回 `/login`
- (合併 Task 9 的 resend 按鈕情境,屆時由 playwright agent 併入同一輪)

### Unit tests

無(專案無 JS test framework — 依 AGENTS.md 以手動 checklist 為準)。文件提及 `next/experimental/testing/server` 的 `unstable_doesProxyMatch` 可測 matcher,但屬 experimental 且專案無 test runner,本 task 不引入。

## Architecture Notes

- **無模式偏離**:沿用 Task 4 建立的 proxy 集中式 auth gate,僅擴充頁面維度;fail-closed 精神一致(受保護頁面用等於或前綴匹配,子路徑預設也被保護)。
- **已知限制(接受)**:matcher 須為靜態字面值,`PROTECTED_PAGES`/`AUTH_PAGES` 與 `config.matcher` 需手動同步 — 以並排註解降低漏改風險。新增頁面若只加常數忘了 matcher,行為是「該頁不受保護」;因此 checklist 第 1 條(受保護頁 redirect)是每次新增後的必測項。
- **效能**:matcher 精準列舉,`/`、靜態資源零 proxy 開銷;三個頁面路徑進 proxy 各多一次 `supabase.auth.getUser()`(與 API 請求相同成本),可接受。
- **不做 returnTo**:登入後導回原頁明確 out of scope,redirect 目標維持固定常數(這同時是 open redirect 的防線 — 之後若加 returnTo,必須做白名單驗證,先在此留痕)。
- **auth-adjacent 變更旗標**(AGENTS.md 規則):本 task 修改 auth gate 檔案 `src/proxy.ts` — PR Reviewer 依規則以 Critical 級檢視,重點:API 分支 diff 應為零行為變更、cookie 轉移正確、matcher 未誤含靜態資源。

## Security Checklist

- [ ] No hardcoded secrets or credentials(proxy 只經 `updateSession` 用 publishable key,env 讀取;不新增任何 key)
- [ ] Input validation at system boundaries(pathname 由 Next.js normalize;匹配用等於/前綴,不解析使用者輸入)
- [ ] Auth/permission checks in place:fail-closed 不變 — 新 API 路由預設 401、受保護頁子路徑預設 redirect
- [ ] No sensitive data logged:不 log token/session/cookie/user 物件
- [ ] **無 open redirect**:redirect 目標僅 `LOGIN_PATH`/`HOME_PATH` 兩個程式內常數,不讀取 query/header/body 任何使用者輸入
- [ ] Session refresh cookie 在 redirect response 上不遺失(比照既有 401 分支的 cookie 轉移)
- [ ] API 契約不變:未登入 `/api/*` 仍為 401 JSON,絕不對 API 請求回 3xx(避免破壞前端 fetch 錯誤處理)
- [ ] `service_role` key 不進 proxy(維持只用 `middleware.ts` factory)

## Definition of Done

- [ ] All implementation steps complete(proxy.ts 擴充 + manual checklist 追加)
- [ ] 手動抽驗:未登入 /profile → /login;未登入 /api/profile → 401 JSON
- [ ] `npm run lint`、`npx tsc --noEmit`、`npm run build` 通過
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows all rules in AGENTS.md(factory 使用、fail-closed、不直連 supabase)
- [ ] Security checklist passed
- [ ] task-log 記載 playwright 欠帳(與 Task 9 合併執行)
