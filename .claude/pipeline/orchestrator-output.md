# Orchestrator Output — Task 2

> Story: 會員系統 | Task 2 of 7 | Type: BACKEND

## Task
[BACKEND] 建立 `/api/auth/register`、`/api/auth/login`、`/api/auth/logout` API routes,包裝 Supabase server-side SDK,處理註冊時自動建立對應 profile。**含 email 驗證 callback route** (調整版新增)。

## Confirmed Decisions (from user)
1. **Session 策略**: httpOnly cookie,使用 `@supabase/ssr`。前端不直接呼叫 Supabase,一律打自己的 API route;session token 存在 httpOnly cookie (防 XSS),由 API route 讀寫/刷新。
2. **Email 驗證**: **啟用**。註冊後帳號未驗證、不可登入、不自動登入;使用者需點驗證信連結完成驗證才能登入。
3. **Email 寄送**: 開發階段用 Supabase 內建 SMTP (有頻率限制,測試夠用);正式 SMTP 之後再接,不在本 task。

## Plan Dependency (需 architect/developer 處理)
- 需安裝 `@supabase/supabase-js` 與 `@supabase/ssr` (專案目前未裝)。這是本 task 的前置依賴。
- Supabase Dashboard / `config.toml` 需確認 email confirmation 為啟用狀態 (預設啟用)。這是設定,非程式碼。

## Scope (this task)
建立以下 API route (App Router route handlers):
- `POST /api/auth/register` — email + 密碼註冊。呼叫 Supabase Auth 建立使用者 (未驗證)。**不**在此處建 profile (見下方註冊/profile 建立策略)。回傳「請收信驗證」訊息,不建立 session。
- `POST /api/auth/login` — email + 密碼登入。驗證通過後透過 `@supabase/ssr` 設定 httpOnly cookie session。未驗證信箱登入應回傳明確錯誤 (Supabase 會擋)。
- `POST /api/auth/logout` — 清除 session cookie。
- `GET /api/auth/confirm` (或 `/auth/callback`) — email 驗證連結的 callback。交換 code/token 換 session,標記驗證完成,導向適當頁面。

## 註冊時 profile 建立策略 (重要決定)
因為 email 驗證啟用,註冊當下使用者尚未驗證。profile 建立時機兩個選項,architect 擇一並說明:
- **選項 A (建議)**: 用資料庫 trigger (`on auth.users insert` → 自動 insert profiles)。註冊/驗證流程完全不用管 profile,DB 層自動處理,最穩妥。但需新增一支 migration (Task 1 沒做這個 trigger)。
- **選項 B**: 在 email 驗證 callback 成功後,由 API route 用 secret key 建立 profile。
> architect 請評估:選 A 需補一支 migration (屬本 task 合理範圍,因為 Task 1 只建表未建 auto-insert trigger);選 B 純應用層。建議 A,因為符合 story「RLS/DB 層防護」精神且不會漏建。

## Acceptance Criteria (this task)
- `POST /api/auth/register` 帶合法 email+密碼 → 回傳成功 (帳號建立、未驗證),提示前往收信;**不**建立 session cookie。
- 重複 email 註冊 → 回傳明確錯誤 (不可洩漏過多帳號存在與否的資訊,但需可用)。
- 未驗證帳號 `POST /api/auth/login` → 回傳「請先驗證信箱」類錯誤,不給 session。
- 已驗證帳號 `POST /api/auth/login` 帶正確帳密 → 設定 httpOnly cookie session,回傳成功。
- `GET /api/auth/confirm` 帶合法驗證 token → 標記驗證完成,建立對應 profile (依所選策略),導向 (或回傳可導向的結果)。
- `POST /api/auth/logout` → 清除 session cookie,之後受保護資源不可存取。
- profile: 使用者驗證完成後,`profiles` 表存在對應該 user 的 row (role 預設 `user`)。

## Edge Cases / Notes for QA
- 無效 email 格式 / 弱密碼 → 400,清楚錯誤訊息,不 500。
- 缺欄位 (沒帶 email 或 password) → 400。
- 登入密碼錯誤 → 401,不透露是帳號不存在還是密碼錯 (避免帳號枚舉)。
- 驗證 token 過期 / 無效 → 明確錯誤,不 500。
- 所有 route 不得 log 密碼、token、session。
- secret key 只在 server 端使用,絕不外流前端。

## Security (依 AGENTS.md — auth 相關自動 🔴 Critical 審視)
- 密碼交給 Supabase Auth 處理 (bcrypt),自己不碰明文儲存。
- httpOnly + Secure + SameSite cookie 設定正確。
- secret key 走 env,不 hardcode。
- 輸入驗證在 API 邊界。

## Out of Scope
- 前端頁面 (Task 5)。
- middleware 路由保護 (Task 4)。
- `/api/profile` 讀寫 (Task 3)。
- 忘記密碼 / 重設密碼 (本 story 未列)。
