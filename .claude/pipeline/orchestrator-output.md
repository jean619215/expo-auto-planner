# Orchestrator Output — Task 3

> Story: 會員系統 | Task 3 of 7 | Type: BACKEND

## Task
[BACKEND] 建立 `/api/profile` API (GET/PATCH),驗證 token 後只能讀寫呼叫者自己的 profile。

## Confirmed Decisions (from user)
1. **GET /api/profile**: 回當前登入者 profile (`id`、`nickname`、`role`、`created_at`、`updated_at`)。未登入 → 401。
2. **PATCH /api/profile**: 只允許改 `nickname`。`role`/`id`/`created_at`/`updated_at` 不可改。
3. **非法欄位處理**: PATCH body 帶任何不允許的欄位 (如 `role`) → **整個請求回 400 拒絕**,不默默忽略。
4. **身分來源**: 一律從 session cookie 取得使用者身分 (`supabase.auth.getUser()`),**不接受** query string / body 傳 user id。
5. **nickname 規則**: 字串、長度上限 50 字、允許清空 (空字串或 null)。

## Scope (this task)
- `src/app/api/profile/route.ts` — GET + PATCH 兩個 handler。
- 使用既有的 `createSupabaseServerClient` (cookie session) 驗證身分。
- 資料存取: 用使用者情境 client 查/改 profiles (RLS 第二道防線自然生效),或依 architect 判斷是否需 admin client (原則上不需要 — 使用者操作自己的 row,RLS 允許)。
- 手動測試: 更新/擴充 Insomnia 匯入檔 + manual checklist。

## Acceptance Criteria
- 已登入 GET → 200,回自己的 profile 五欄位。
- 未登入 GET → 401。
- 已登入 PATCH `{"nickname":"新名字"}` → 200,回更新後 profile;DB 裡 `updated_at` 由 trigger 自動更新。
- PATCH nickname 超過 50 字 → 400。
- PATCH 帶 `role` 或其他非法欄位 → 400,不更新任何東西。
- PATCH 空 body / 非 JSON → 400。
- 未登入 PATCH → 401。
- 無法讀取或修改他人 profile (身分只來自 session,無路徑可指定他人 id)。

## Edge Cases / Notes for QA
- profile row 理論上必存在 (DB trigger 建立);若查無 row (異常情況) → 404 或 500 擇一,需明確處理不可默默回空。
- nickname 清空 (null 或 "") → 允許,200。
- 不 log 任何 token/session。

## Out of Scope
- middleware 全域路由保護 (Task 4;本 task 在 route 內自行驗證)。
- 前端頁面 (Task 6)。
- role 管理/變更功能。
