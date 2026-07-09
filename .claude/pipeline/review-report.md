# Code Review Report — 會員系統 / Task 2（auth API routes + email 驗證 + profile trigger）
> Generated: 2026-07-09T05:40:00Z | Review iteration: 1 | Reviewer: PR Reviewer agent

## Overall Assessment
**APPROVED WITH MINOR FIXES**

本 task 為 auth-adjacent，依 AGENTS.md 以最嚴（🔴）標準審視。逐項核對 session/cookie 安全、secret key 隔離、密碼處理、帳號枚舉防護、輸入驗證、confirm token 流程、open redirect、trigger 權限提升等，**未發現任何真正的安全漏洞**（無 token/key 洩漏、無 open redirect、無 RLS/權限繞過、無 hardcoded 密鑰）。實作忠實落實 architect-plan 與 orchestrator 已核可的 auth 決策。故本 auth task **不觸發 🔴 Critical、不需人工暫停**，僅有 1 項可由 developer 自動修正的 🟡 Should Fix 與數項 💡 Consider。

## Summary
4 支 route handler（register/login/logout/confirm）+ 2 支 lib client（user/admin）+ 1 支 trigger migration + 手動測試 checklist 皆到位，範圍精準（未混入前端/middleware/profile API 等後續 task）。session cookie 全交由 `@supabase/ssr` 管理（httpOnly/SameSite/(prod)Secure），secret key 僅在 server 端 `admin.ts` 使用且只被 register route import。`npm run lint` 通過、無 debug log、無 TODO。

---

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
**無。** 已依 AGENTS.md「auth 變更自動 🔴」標準逐項複核，未發現實際安全漏洞，故判定「已審視通過、不阻擋」，不設 `review_critical_pending`。

### Auth Security Checklist 審視結果（全 PASS）
- **Session/cookie**：`server.ts` 正確 `await cookies()`（Next.js 16 async cookies），以 `getAll`/`setAll` 介面接 `@supabase/ssr`，httpOnly/SameSite/(prod)Secure 由函式庫設定，未手動降級成可被 JS 讀取 → 無 XSS 竊取 session 風險。**PASS**
- **Secret key 隔離**：`SUPABASE_SERVICE_ROLE_KEY` 僅出現在 `src/lib/supabase/admin.ts`；`grep` 確認全專案僅 `register/route.ts` 一處 import admin client，無任何 `use client` 檔案觸及，永不加 `NEXT_PUBLIC_` 前綴 → 不會進前端 bundle。**PASS**
- **密碼處理**：完全交給 Supabase Auth（`signUp` / `signInWithPassword`），route 不碰明文、不儲存、不 log。**PASS**
- **帳號枚舉**：register 對成功與 Supabase 錯誤（含重複 email）一律回相同通用訊息；login 對「密碼錯」與「帳號不存在」一律回 401 通用「帳號或密碼錯誤」，未驗證帳號回 403 明確訊息。**PASS**
- **輸入驗證**：每支 route 於邊界檢查缺欄位/型別/email 格式/密碼長度，`request.json()` 包 try/catch，壞輸入回 400 非 500。**PASS**
- **confirm token 流程 / open redirect**：採 token_hash + `verifyOtp` server-side 流程；成功後 `Response.redirect(origin, 303)` 的 `origin` 取自 `new URL(request.url)`（伺服器自身 origin），**非**使用者可控的 query 參數 → 無 open redirect。type 參數以白名單 `EmailOtpType` 驗證。**PASS**
- **trigger 權限**：`security definer` + `set search_path = ''` + 全 schema-qualified 名稱（`public.profiles` / `public.handle_new_user`）；對照 Task 1 migration 確認 `public.profiles(id)` 為合法 PK 且 `role default 'user'`；`on conflict (id) do nothing` 冪等 → 無 search_path 注入、無權限提升。**PASS**
- **hardcode / 敏感 log**：無 hardcoded 密鑰或連線字串，全走 env；無 debug log 洩漏密碼/token/session。**PASS**

---

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — register 對所有 signUp 錯誤一律靜默回成功，缺 server 端可觀測性
- **File**: `src/app/api/auth/register/route.ts:56-58`
- **Issue**: 為防帳號枚舉，`if (error)` 分支對「重複 email」與「任何其他錯誤」（Supabase 服務中斷、寄信頻率上限 `over_email_send_rate_limit`、網路失敗等）都回相同的成功訊息，且**完全不做 server 端記錄**。對外回通用訊息本身正確（符合 plan 的枚舉防護），但真正的基礎設施失敗時，使用者被告知「請收信」卻其實什麼都沒發生，營運端也沒有任何訊號可察覺 → 屬 silent failure / 可觀測性缺口。
- **Suggested fix**: 保留對外的通用回應不變（維持枚舉防護），在 `if (error)` 內加一行**不含敏感資料**的 server 端 log（例如 `console.error("register signUp failed", { code: error.code })`，切勿記 email 全值/password/token）；或針對可安全區分的非枚舉類錯誤（如 rate limit）回對應 4xx。重點是失敗要在 server 留痕，而非一律偽裝成功。

---

## 💡 Suggestions (Consider — No Action Required)
1. **共用驗證邏輯重複**：register 與 login 的 body 解析 + 缺欄位/型別檢查幾乎逐字相同（各自 `route.ts:9-30` / `:5-25`）。可抽成 `src/lib/http/` 下的小 helper，降低日後兩處漂移風險。無功能問題，屬整潔度。
2. **confirm 成功導向目標**：`Response.redirect(origin, 303)` 導回站台根路徑。Task 5 前端頁尚未建立，目前合理；待前端就緒後應改導向明確的「驗證成功」頁。已在計畫記錄，僅提醒。
3. **密碼長度上界**：目前僅檢查下界 6。可選擇性加合理上界（如 ≤ 72/128）以避免超長輸入。Supabase 自身有處理，屬防禦深度的 nice-to-have。
4. **email 正則為基本檢查**：`EMAIL_REGEX` 僅粗略格式驗證，最終正確性由 Supabase 寄信驗證把關。可接受，僅記錄。

---

## Security Assessment
- Secrets scan: **PASS**（無 hardcoded 密鑰；service_role key 僅 server 端、僅 `admin.ts`、未進前端 bundle）
- Input validation: **PASS**（所有 route 邊界驗證，壞輸入 400 非 500）
- Auth/authz: **PASS**（httpOnly cookie 由 `@supabase/ssr` 管理；未驗證帳號 login 擋 403；register 不發 session；trigger 無權限提升）
- Open redirect: **PASS**（confirm 導向 origin 取自伺服器，非使用者輸入）
- Test coverage: 0% 自動化（延續 Task 1 已核可的無測試框架狀態；改以 `supabase/tests/auth_routes_manual.md` 手動 checklist 覆蓋全部驗收與 edge case。QA 依 AGENTS.md 仍會標示 0 自動覆蓋，屬已知並接受）

---

## Plan Compliance
- [x] architect-plan 全部步驟已實作（4 route + 2 client + trigger migration + 手動 checklist + config/env/套件）
- [x] 實作符合計畫意圖（兩個 client 分工、選項 A DB trigger、token_hash confirm 流程、email 驗證啟用）
- [x] 無未授權的範圍擴張（未觸及 Task 3/4/5 的 profile API、middleware、前端頁）
- [x] env 命名一致：程式碼與 `.env.example` 均採使用者最終確認的 `SUPABASE_SERVICE_ROLE_KEY`（覆蓋 plan 早期暫定的 `SUPABASE_SECRET_KEY`；`admin.ts` 與 `.env.example` 已對齊，無混用）
- [x] `config.toml` `enable_confirmations = true` 已改
- [x] `@supabase/supabase-js` + `@supabase/ssr` 為指定 client（符合 AGENTS.md「不得 ad hoc 加 DB client」）
- [x] `@/*` alias、lib 置於 `src/lib/`、`npm run lint` 通過

---

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| Issue 1 — register 靜默成功缺 server log | (待 developer 處理) | pending — 加非敏感 server log，維持對外通用訊息 |
