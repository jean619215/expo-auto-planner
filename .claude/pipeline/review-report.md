# Code Review Report — 個人資料頁面 (/profile)
> Generated: 2026-07-10T12:06:32Z | Review iteration: 1 | Reviewer: PR Reviewer agent
> Story: 會員系統 | Task 6 of 9 | Type: FRONTEND

## Overall Assessment
APPROVED

## Summary
實作與 architect plan 逐步吻合、與後端契約完全對齊，架構規則（前端僅打 `/api/*`、零 Supabase import、零 secrets）全數通過。UI 狀態機完整（loading/ready/unauthenticated/error）、React 正確性佳（`active` flag 防 unmount setState、模組層 Intl formatter、無 hydration 風險）、無範圍外的 redirect 邏輯。`npm run lint` 通過。無 Critical、無 Should Fix，僅 3 項可選建議。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: `src/lib/profile-client.ts:34`
- **Issue**: 200 但 body 非 JSON/空時，`toResult` 會回 `profile: {}`（`{} as Profile`），頁面會以 undefined 欄位渲染（暱稱空、建立時間 `-`）。後端 200 必回 JSON，實務上不會發生，僅是防禦深度考量。
- **Suggested**: 可加 `"id" in data` 之類的 shape 檢查，失敗時視為 error。純可選。

### Suggestion 2
- **File**: `src/app/profile/page.tsx:126`
- **Issue**: 儲存成功後再次編輯暱稱時，「暱稱已更新」綠色訊息會殘留到下次送出才清除。UX 微調。
- **Suggested**: `onChange` 時順帶 `setSaveSuccess("")`。

### Suggestion 3
- **File**: `src/components/AuthNav.tsx:20`
- **Issue**: `AuthNav` 仍以裸 `fetch("/api/profile")` 推斷登入狀態（既有程式碼，非本次新增）；本次已有 `getProfileRequest()` wrapper，可順手改用以統一模式。非本 task 義務。

## Security Assessment
- Secrets scan: **PASS** — grep 全部審核檔案，無 secrets/token/連線字串/service_role/`@supabase/*` import
- Input validation: **PASS** — client 端 `isValidNickname`（`[...str].length <= 50`，code point 計數）與後端 `route.ts:79` 完全一致；後端 400 仍為最終防線
- Auth/authz: **PASS** — 全走同源相對路徑 + `credentials: "same-origin"`（httpOnly cookie）；401 顯示通用「請先登入」+ 連結，不 redirect（Task 7 範圍）、不洩漏帳號存在性；`role` 純文字唯讀，無任何可修改 role 的 UI 或請求
- Sensitive logging: **PASS** — 新增程式碼零 `console.log`，不 log token/session/cookie/密碼
- Test coverage: 手動 checklist `supabase/tests/auth_routes_manual.md` §8（8.1–8.10）完整涵蓋全部驗收條件與 edge cases（null nickname、離線、防重複、敏感 log 檢查）；Playwright 驗收情境 8 條已定義於 architect plan，交付 playwright 階段

## Contract Compliance（重點逐項）
- PATCH body 恰為 `{"nickname": <string>}` 單一鍵（`profile-client.ts:55`）✅
- 清空送 `""`，正規化為 null 留在後端（`route.ts:84`）、前端不 trim、依回傳 profile 更新畫面 ✅
- nickname null → 輸入框空字串，絕不顯示 "null"（`?? ""`，載入與儲存後皆處理）✅
- 401 於載入與儲存中途 session 失效兩處皆轉 `unauthenticated` ✅
- `saving` 期間 input + 按鈕 disabled、「儲存中…」、`if (saving) return` 防重複 ✅
- 不顯示 `id`/`updated_at`；`created_at` 以 `Intl.DateTimeFormat("zh-TW")` 格式化 + `Number.isNaN` 防呆 ✅
- useEffect `active` flag cleanup 防 unmount 後 setState；client-only 資料流無 SSR hydration mismatch ✅

## Plan Compliance
- [x] All architect plan steps implemented（9 步全數，含 AuthNav 落點修正——`page.tsx` 零改動，符合 plan Architecture Notes 說明）
- [x] Implementation matches plan intent（檔案結構、state 設計、文案、樣式均對齊 Task 5 login/register 慣例）
- [x] No unauthorised scope additions（無 redirect/Task 7 內容、無 email/頭像、無新依賴）

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| （無 🟡 項目，無需開發者回應） | — | — |
