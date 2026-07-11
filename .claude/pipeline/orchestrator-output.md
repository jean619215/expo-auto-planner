# Orchestrator Output — Task 8

> Story: 會員系統 | Task 8 of 9 | Type: BACKEND

## Task
[BACKEND] 建立 `/api/auth/resend` API,包 `supabase.auth.resend({type:'signup'})`,一律回通用 200 防枚舉,429/錯誤只記 server log;正式環境 `config.toml` `max_frequency` 調為 60s。

## Confirmed Decisions (story 追加時已與使用者確認)
1. `POST /api/auth/resend` — body `{email}`。呼叫 `supabase.auth.resend({ type: "signup", email })` 重寄驗證信。
2. **防枚舉**: 無論 email 是否存在/已驗證/被 rate limit,一律回 **200 + 同一句通用訊息** (對齊 register 的防枚舉模式,含 status code 一致)。
3. 429/其他 Supabase 錯誤: 只記 server log (`console.error`,不含 email/token),對外仍通用 200。
4. `supabase/config.toml` `[auth.email]` 的 `max_frequency` 設 60s (伺服器端冷卻,防濫發)。前端 60 秒倒數是 Task 9。
5. 此 route 是**公開 API** — 必須加進 `src/proxy.ts` 的 `PUBLIC_API_PATHS` 白名單 (未登入者才需要重寄驗證信)。

## Backend 契約 (供 Task 9 前端對齊)
- `POST /api/auth/resend` body `{"email": "..."}`
  - 缺 email / 格式錯 → 400 `{"error":"..."}` (輸入驗證,對齊 register 風格)
  - 其他一律 → 200 `{"message":"若該信箱已註冊且尚未驗證，驗證信已重新寄出"}` (通用訊息,固定一句)
- 用哪個 client: register 用的是 admin client (signUp);resend 評估用 server (anon) client 即可 — 由 architect 依 supabase-js resend API 需求定案。
- 註: emailRedirectTo 需與 register 一致 (`${NEXT_PUBLIC_SITE_URL}/api/auth/confirm`),讓重寄的信也走同一 confirm 流程。

## Acceptance Criteria
- 合法 email (已註冊未驗證) POST → 200 通用訊息,實際重寄驗證信。
- 不存在的 email POST → **同樣 200 同一句訊息** (status + body 完全一致,防枚舉)。
- 已驗證的 email POST → 同樣 200 通用訊息 (Supabase 端不會寄,對外不可區分)。
- 被 rate limit (max_frequency 內重複) → 對外仍 200 通用訊息,server log 記錯誤碼。
- 缺 email / 格式錯 → 400。
- 未登入可呼叫 (在 proxy 白名單內)。
- 不 log email/token/session 於錯誤訊息外洩層級 (server log 僅錯誤碼/訊息)。

## Edge Cases / Notes for QA
- 非 JSON body → 400 不 500。
- proxy 白名單漏加 → 未登入呼叫會 401,直接違反驗收 — QA 必查 proxy.ts。
- manual checklist + Insomnia 檔各加 resend 請求。

## Out of Scope
- 前端按鈕與倒數 (Task 9)。
- 忘記密碼重寄 (type 只做 signup)。
