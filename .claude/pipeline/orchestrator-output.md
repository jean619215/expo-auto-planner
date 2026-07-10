# Orchestrator Output — Task 6

> Story: 會員系統 | Task 6 of 9 | Type: FRONTEND

## Task
[FRONTEND] 建立個人資料頁面 (顯示/編輯暱稱等欄位),呼叫 `/api/profile`。

## Confirmed Decisions (from user)
1. **路由**: `/profile` (`src/app/profile/page.tsx`)。首頁已登入狀態下加「個人資料」連結入口。
2. **顯示欄位**: 暱稱 (可編輯)、role、建立時間 (`created_at`,格式化顯示)。`id` 不顯示 (使用者不需看 uuid);`updated_at` 可不顯示。
3. **編輯**: 暱稱 inline 編輯 + 儲存按鈕 → `PATCH /api/profile` (body 恰為 `{"nickname": ...}`)。成功顯示成功訊息並更新畫面;失敗顯示後端 `error` 訊息。前端同步做 client 端驗證: ≤50 字 (Unicode code point 計,對齊後端)。
4. **未登入造訪 `/profile`**: 本 task 顯示「請先登入」+ 前往登入頁連結 (fetch 收到 401 時)。自動 redirect 是 Task 7 範圍。
5. **FRONTEND task**: QA 通過後需跑 playwright 階段,瀏覽器實測驗收條件。

## Backend Contract (現有 route,前端須對齊)
- `GET /api/profile` — 已登入 200 `{id,nickname,role,created_at,updated_at}` (nickname 可能為 null);未登入 401 `{"error":"請先登入"}`;查無 row 404。
- `PATCH /api/profile` — body 必須恰為 `{"nickname": string|null}`;成功 200 回更新後 profile;>50 字或非法欄位 400;未登入 401。
- 前端一律相對路徑 fetch,同源自動帶 httpOnly cookie。不直接呼叫 Supabase client。

## Scope (this task)
- 新增 `src/app/profile/page.tsx` (`"use client"`,需互動)。
- 載入時 GET `/api/profile`: loading 狀態 → 成功渲染欄位 / 401 顯示請先登入+連結 / 其他錯誤顯示通用錯誤。
- 暱稱編輯表單: 輸入框 (預填現值,null 顯示空)、儲存按鈕、送出中 disabled 防重複、成功/錯誤訊息 inline 顯示。
- client 端驗證: >50 字擋下提示 (仍以後端 400 為準)。
- 首頁 `src/app/page.tsx`: 已登入狀態加 `/profile` 連結。
- 樣式: Tailwind v4,對齊既有 login/register 頁風格。文案繁體中文。

## Acceptance Criteria
- 已登入造訪 `/profile` → 顯示暱稱、role、建立時間。
- 修改暱稱送出 → 200 後畫面更新為新暱稱 + 成功訊息。
- 暱稱輸入 >50 字 → client 端擋下或後端 400,錯誤訊息顯示。
- 清空暱稱送出 → 允許 (後端正規化 null),畫面顯示空。
- 未登入造訪 `/profile` → 顯示「請先登入」與登入頁連結,不崩潰。
- 送出期間按鈕 disabled,不可重複送出。
- 首頁已登入時有 `/profile` 入口。
- 全程不直接呼叫 Supabase client,不出現 service_role key。

## Edge Cases / Notes for QA
- nickname 為 null 時輸入框顯示空字串,不顯示 "null"。
- 網路錯誤 / 非預期 status → 通用錯誤訊息,不整頁崩潰。
- 不 log token/session。
- role 欄位唯讀,無任何 UI 可改 role。

## Out of Scope
- 未登入自動 redirect (Task 7)。
- email 顯示 (profile API 不回 email)。
- 頭像/其他欄位。
