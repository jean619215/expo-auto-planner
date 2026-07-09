# Code Review Report — 建立 /api/profile API (GET/PATCH)
> Generated: 2026-07-09T15:40:00+08:00 | Review iteration: 1 | Reviewer: PR Reviewer agent
> Story: 會員系統 | Task 3 of 7

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
`src/app/api/profile/route.ts` 完整實作 architect plan 全部步驟：驗證順序（先身分後 body）、白名單整包拒絕、Unicode code point 長度計算、`""` → `null` 正規化皆與規格一致。本 task 為 auth-adjacent（消費既有 session），已依 AGENTS.md 以 🔴 Critical 標準逐項審視——**未發現任何安全漏洞**，越權路徑不存在、RLS 第二道防線完整，判定「已審視通過、不阻擋」。`npm run lint` 與 `npx tsc --noEmit` 皆通過。僅一項測試文件的 plan 對齊小缺口（🟡）。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

### Auth-adjacent 強制審視結果（AGENTS.md 自動 🔴 標準，逐項通過）
1. **身分驗證**：GET/PATCH 皆先 `getAuthenticatedUser()`（`supabase.auth.getUser()`），`error` 或無 user → 401（route.ts:27-30, 54-57）。身分唯一來自 session cookie；query string 完全未讀取，body 帶 `id`/任何非 `nickname` key 被白名單整包 400（route.ts:70-73），header 亦未讀取。**無任何路徑可指定他人 id**。
2. **Client 選擇**：只 import `@/lib/supabase/server`（cookie 情境、publishable key），全檔無 admin client import → `profiles_select_own`/`profiles_update_own` RLS 第二道防線有效。查詢/更新皆 `.eq("id", user.id)`（第一道防線）。
3. **白名單**：`Object.keys(body)` 必須恰為 `["nickname"]`；空物件 `{}`、多餘 key、`role`、`id` 皆 400。plain object 檢查（`typeof "object"`、非 null、非 Array）先行，array/字串/數字 body 皆 400。**Prototype pollution 不可行**：`JSON.parse` 對 `"__proto__"` 建立 own property → 出現在 `Object.keys` → 400；且 update payload 為字面量 `{ nickname }`，非 spread 使用者輸入。型別繞過（nickname 傳 array/object/number/boolean）被 `typeof !== "string" && !== null` 擋下 → 400。
4. **nickname 驗證**：string 或 null；`[...rawNickname].length > 50` 以 Unicode code point 計（符合 plan Key Decision 4）；`""` 於驗證後正規化為 `null` 才寫入（route.ts:77-84）。manual doc 6.6 的 51 字測試字串已實際驗證為 51 code points。
5. **查無 row**：GET/PATCH 皆 `maybeSingle()` + `data === null` → 404「找不到會員資料」，server log 僅含 user id（非敏感），不默默回空（route.ts:43-46, 98-101）。RLS 拒絕回 0 rows 的情境亦落入此分支，不會誤判成功。
6. **錯誤處理**：`request.json()` 以 try/catch 包裹，非 JSON body → 400 不 500；DB error → 500 且 log 僅 `error.code`/`error.message`。無未捕捉例外路徑（`createSupabaseServerClient` 僅在 env 缺失時拋錯，屬部署設定問題，與既有 auth routes 行為一致）。
7. **不洩漏敏感資料**：全檔無 token/session/cookie/email 進 log；回傳欄位由 `PROFILE_COLUMNS` 常數限定恰為 `id, nickname, role, created_at, updated_at` 五欄，無多洩 email。
8. **範圍**：僅新增 `src/app/api/profile/route.ts` + 更新兩份手動測試檔，無 middleware/前端混入，無 scope creep。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1
- **File**: supabase/tests/insomnia_auth.json
- **Issue**: architect plan Implementation Step 6 / Test Plan 明列 Insomnia 需追加「未登入 GET」request，實作只加了 4 個 profile requests（GET、PATCH 合法、PATCH 帶 role、PATCH 超長 nickname），缺未登入 401 案例。
- **Suggested fix**: 在 `fld_profile` group 追加「10. GET profile 未登入 → 401」request（description 註明需清空 cookie 後執行，或設 `settingSendCookies: false`）。
- **Impact**: 非安全問題——manual checklist 6.1/6.2 已完整覆蓋 401 情境，僅為兩份測試文件間的 plan 對齊缺口，不阻擋 pipeline。

## 💡 Suggestions (Consider — No Action Required)
1. **route.ts:14** — `SupabaseClient` 使用預設 generics，`from("profiles")` 回傳型別寬鬆。日後可導入 supabase gen types 取得 DB schema 型別（等 lib 層慣例確立後再做，避免過早抽象）。
2. **route.ts:84** — nickname 未 trim：`"   "`（全空白）會原樣存入而非視為清空。spec 未要求，僅列為未來 UX 考量。

## Security Assessment
- Secrets scan: PASS（無 hardcode；Supabase URL/key 走 env；Insomnia env 的 `password123` 為本機測試 placeholder，沿用既有檔案慣例）
- Input validation: PASS（JSON 解析 → plain object → key 白名單 → 型別 → 長度，五層依序把關）
- Auth/authz: PASS（session-only 身分 + `.eq("id", user.id)` + RLS 雙防線；無越權路徑）
- Sensitive data in logs: PASS（僅 error code/message/user id）
- CORS/CSP: 未變動
- Test coverage: 無自動化框架（Task 1/2 既定核可做法）；manual checklist 第 6 段共 9 小節 + Insomnia 4 requests，覆蓋全部驗收條件含安全斷言 6.9（他人 id 越權嘗試）
- Lint / typecheck: PASS（`npm run lint`、`npx tsc --noEmit` 皆通過）

## Plan Compliance
- [x] All architect plan steps implemented（唯 Step 6 的 Insomnia「未登入 GET」缺漏 → 🟡 Issue 1）
- [x] Implementation matches plan intent（含 Key Decisions 1-4：inline helper 不過早抽象、user-context client、`""`→`null`、code point 計長）
- [x] No unauthorised scope additions（無 middleware/前端/DB client 混入）

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡 Issue 1（Insomnia 缺未登入 GET request） | 待 developer agent 補上 | 已交辦；不阻擋 pipeline（401 情境於 manual checklist 6.1/6.2 已覆蓋） |
