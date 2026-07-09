# QA Report — 建立 /api/profile API (GET/PATCH)
> Generated: 2026-07-09T16:20:00+08:00 | QA iteration: 1
> Story: 會員系統 | Task 3 of 7 | Type: BACKEND

## Testing Method
專案無 Docker、無 JS 測試框架、QA 環境無法啟動 dev server + 本機 Supabase 實際打 API，延續 Task 1/2 已核可做法，採**靜態驗收**——逐行比對程式碼實作、`supabase/tests/auth_routes_manual.md` 第 6 段、`supabase/tests/insomnia_auth.json`，與 `orchestrator-output.md` 驗收條件、`architect-plan.md` test plan 逐條核對，並核對 `supabase/migrations/20260708173519_create_profiles.sql` 確認 RLS policy 與 trigger 實際存在。

檔案清單（本次讀取）：
- `src/app/api/profile/route.ts`（全文）
- `supabase/tests/auth_routes_manual.md` 第 6 段（6.1–6.9）
- `supabase/tests/insomnia_auth.json`（`fld_profile` group 全部 request + base environment `nickname_too_long`）
- `supabase/migrations/20260708173519_create_profiles.sql`（RLS policy、trigger 確認）
- `.claude/pipeline/orchestrator-output.md`、`architect-plan.md`、`review-report.md`

## Summary
- Tests executed: 17（8 驗收條件 + 3 edge case + 3 安全斷言 + 1 review 補件確認 + 2 regression）
- Passed: 17
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — 所有驗收條件、edge case、安全斷言皆通過，review 🟡 補件已確認完成，無 bug，QA 簽核通過。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| 已登入 GET → 200，回自己 profile 五欄位 | ✅ PASS | route.ts:32-48，`PROFILE_COLUMNS` 恰為 `id,nickname,role,created_at,updated_at`，`.eq("id", user.id)`；manual 6.3、insomnia `req_profile_get` 對應 |
| 未登入 GET → 401 | ✅ PASS | route.ts:27-30；manual 6.1；insomnia `req_profile_get_unauth`（review 補件，見下方確認） |
| 已登入 PATCH `{"nickname":"新名字"}` → 200，回更新後 profile；`updated_at` 由 trigger 更新 | ✅ PASS | route.ts:86-103；`profiles_set_updated_at` trigger 於 migration:56 確認存在，route 未手動塞 `updated_at`；manual 6.4、insomnia `req_profile_patch` |
| PATCH nickname 超過 50 字 → 400 | ✅ PASS | route.ts:79 用 `[...rawNickname].length`（code point）；manual 6.6 提供 51 中文字字串；insomnia env `nickname_too_long` 實測確為 51 code points |
| PATCH 帶 `role` 或其他非法欄位 → 400，不更新任何東西 | ✅ PASS | route.ts:70-73 白名單 `Object.keys(body)` 須恰為 `["nickname"]`；manual 6.7 含 Studio 覆核未變動；insomnia `req_profile_patch_role` |
| PATCH 空 body / 非 JSON → 400 | ✅ PASS | route.ts:59-68（try/catch JSON 解析、plain-object 檢查、空物件因 `keys.length !== 1` 落入 400）；manual 6.8 涵蓋 `{}`/非 JSON/型別錯誤 |
| 未登入 PATCH → 401 | ✅ PASS | route.ts:54-57（先驗身分再解析 body）；manual 6.2 |
| 無法讀寫他人 profile（身分只來自 session，無路徑指定他人 id）| ✅ PASS | 全檔未讀取 query string / header 任何 id；PATCH body 帶 `id` 因白名單整包 400；manual 6.9 三案例（`?id=` 被忽略、body 帶 `id` 400、B 使用者互不可見）皆對應 |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 查無 row（異常）→ 明確處理不可默默回空 | ✅ PASS | route.ts:43-46（GET）、98-101（PATCH）：`data === null` → 404 `PROFILE_NOT_FOUND_ERROR`，且僅 log user id |
| nickname 清空（`""` 或 `null`）→ 200，正規化為 null | ✅ PASS | route.ts:84 `rawNickname === "" ? null : rawNickname`；manual 6.5 兩案例皆驗證回傳 `nickname: null` |
| 不 log 任何 token/session | ✅ PASS | 全檔僅兩處 `console.error`：查詢/更新失敗記 `error.code, error.message`；查無 row 記 `user.id`。全檔無 token/session/cookie/email 字樣進 log |

## Regression Check
| Feature | Result | Notes |
|---|---|---|
| `/api/auth/login` 等既有 auth route（profile route 依賴其 cookie session）| ✅ PASS | route.ts 僅消費既有 `createSupabaseServerClient()`，未修改任何 auth route 檔案 |
| RLS policy `profiles_select_own` / `profiles_update_own`（第二道防線）| ✅ PASS | migration 確認兩條 policy 存在；route.ts 全檔未 import `@/lib/supabase/admin`，未繞過 RLS |

## Security Test（mandatory）
- 敏感資料外洩（回應/UI）：PASS — 回應僅含 `PROFILE_COLUMNS` 五欄位常數，無 email/token 外洩；log 僅 error code/message/user id
- 輸入驗證（所有進入點）：PASS — JSON 解析 try/catch → plain-object 檢查 → key 白名單整包拒絕 → 型別檢查 → 長度檢查，五層防線逐一對照程式碼行號屬實
- Auth 邊界：PASS — 身分唯一來源 `supabase.auth.getUser()`；query string（`?id=`）、header、body 皆無法指定他人 id；PATCH 白名單擋下 body 帶 `id`；RLS 為第二道防線

## Review 補件確認
review-report.md 🟡 Issue 1 要求在 `insomnia_auth.json` 補「未登入 GET → 401」request。已於 `fld_profile` group 確認存在 `req_profile_get_unauth`（"5b. GET profile 未登入 → 401"，description 註明需清空 cookie / logout 後測試，並說明 PATCH 未登入亦同 401）。**確認已補上，缺口已關閉，無殘留未完成項。**

## Bugs Found
無。

## Test Coverage
- New code coverage: N/A（專案無自動化測試框架）
- Minimum required: 依 AGENTS.md「Current coverage: 0%. No test framework installed yet.」— 本 task 以手動 checklist（6.1–6.9，9 小節）+ Insomnia 5 個 request（含 review 補上的未登入 401）完整覆蓋全部驗收條件、edge case 與安全斷言，非「無覆蓋」情形，符合 Task 1/2 已核可的專案現況做法
- Status: PASS
