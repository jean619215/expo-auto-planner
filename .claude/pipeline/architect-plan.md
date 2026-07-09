# Architect Plan — 建立 auth API routes (register/login/logout + email 驗證 confirm callback)

> Story: 會員系統 | Task type: BACKEND | Generated: 2026-07-09T04:30:00Z
> ⚠️ auth-adjacent：本 task 全程觸及認證/session/cookie，依 AGENTS.md 於 review 階段自動 🔴 Critical。所有步驟已套用 security guardrail，實作前務必先讀框架文件（見步驟 0）。

## Overview
建立 4 支 App Router route handlers（register / login / logout / confirm），全部透過 `@supabase/ssr` 的 `createServerClient` 綁定 Next.js `cookies()` 來讀寫 httpOnly session cookie。前端只打自己的 API route，session token 一律存 httpOnly cookie。email 驗證啟用：註冊不建立 session、不建 profile；profile 由 DB trigger 在 `auth.users` insert 時自動建立（選項 A）。

## Task Type Confirmed
BACKEND —（route handlers + 一支 DB migration + 設定調整）。與 orchestrator 的判定一致，無矛盾。

## Escalation / 人工必讀事項（不阻擋，但核准計畫時請一併確認）
1. **auth 模型**：本 task 即 story 已核准的認證實作，決定（httpOnly cookie + `@supabase/ssr` + email 驗證）皆由 orchestrator 記錄使用者確認在案。architect 不新增未經核准的 auth 決策；人工核准此計畫即等同核可此 auth 實作方向。
2. **設定變更（非程式碼，但必要）**：`supabase/config.toml` 第 226 行目前 `enable_confirmations = false`，與「email 驗證啟用、註冊不自動登入」需求衝突。**必須改為 `true`**，否則 Supabase 會在註冊時直接回 session、驗收條件無法達成。列為本 task 的設定依賴。
3. **env 變數命名不一致**：`.env.example` 用 `SUPABASE_SECRET_KEY`，但 `.env.local` 目前是 `SUPABASE_SERVICE_ROLE_KEY`。程式碼只能有一個正解。本計畫統一採 `.env.example` 的命名（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`），developer 需同步修正 `.env.local` 的 key 名（值不動）。請人工確認採此命名。

## Plan Dependencies（實作前置，developer 須先處理）
- **安裝套件**：`@supabase/supabase-js` 與 `@supabase/ssr`（專案目前皆未裝）。以 `npm install @supabase/supabase-js @supabase/ssr` 安裝為 runtime dependency。此為 AGENTS.md「不得 ad hoc 加 DB client」的指定 client，屬本 task 明列依賴。
- **設定**：依上方第 2 點，將 `config.toml` `enable_confirmations` 設為 `true`。
- **env**：依上方第 3 點統一命名；確保 `SUPABASE_SECRET_KEY`（secret / 舊 service_role）只在 server 讀取，永不加 `NEXT_PUBLIC_` 前綴。

## Files to Create
| File path | Purpose |
| --- | --- |
| `src/lib/supabase/server.ts` | 使用者情境 client 工廠：`createServerClient`（publishable key）綁 `await cookies()`，讀寫 httpOnly session cookie。login / logout / confirm 用。 |
| `src/lib/supabase/admin.ts` | 管理員 client 工廠：用 `SUPABASE_SECRET_KEY` 的 `createClient`，**不綁 cookie、關閉 session 持久化**。register 用來呼叫 Auth signUp（避免污染請求 cookie），未來 profile 特權操作亦走此。 |
| `src/app/api/auth/register/route.ts` | `POST` 註冊 handler。 |
| `src/app/api/auth/login/route.ts` | `POST` 登入 handler。 |
| `src/app/api/auth/logout/route.ts` | `POST` 登出 handler。 |
| `src/app/api/auth/confirm/route.ts` | `GET` email 驗證 callback handler。 |
| `supabase/migrations/<timestamp>_auth_users_profile_trigger.sql` | DB trigger：`on auth.users insert` 自動建 profile（選項 A）。用 `supabase migration new auth_users_profile_trigger` 產生正確時間戳檔名。 |
| `supabase/tests/auth_routes_manual.md` | 手動測試 checklist（curl / REST client），含每個 case 的預期 status code 與行為。 |

## Files to Modify
| File path | What changes |
| --- | --- |
| `supabase/config.toml` | `enable_confirmations = false` → `true`（第 226 行）。 |
| `.env.local` | 將 `SUPABASE_SERVICE_ROLE_KEY` 更名為 `SUPABASE_SECRET_KEY`（值不變），與 `.env.example` 對齊。 |
| `package.json` / `package-lock.json` | 由 `npm install` 自動加入兩個 supabase 套件。 |
| email confirmation 模板設定（`config.toml` `[auth.email.template.confirmation]` 或 Dashboard，見步驟 8 註）| 讓驗證信連結指向 `/api/auth/confirm`（token_hash 流程）。屬設定，非程式碼。 |

## 註冊時 profile 建立策略 — 選定：選項 A（DB trigger）
理由：
- 符合 story「RLS / DB 層防護」精神，profile 建立不依賴應用層記得呼叫，永不漏建。
- 驗證流程（confirm route）不需碰 profile，邏輯更單純。
- Task 1 只建表未建 auto-insert trigger，補此 trigger 屬本 task 合理範圍。

**Trigger SQL 要點（developer 照此撰寫，鎖 search_path + 正確 SECURITY DEFINER）：**
```sql
-- supabase/migrations/<timestamp>_auth_users_profile_trigger.sql
-- 在 auth.users 新增時，自動於 public.profiles 建立對應 row（role 預設 'user'）。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- 需以 owner 權限寫入 public.profiles（跨 schema、繞過 RLS）
set search_path = ''        -- 鎖死 search_path，防 search_path 注入
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;   -- 冪等，重放安全
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
```
註：
- 全部物件皆以 schema 限定名（`public.profiles`、`public.handle_new_user`）撰寫，因 `search_path = ''`。
- `role` 不在 insert 指定，交由 profiles 表的 `default 'user'` 產生 → 滿足驗收「role 預設 user」。
- trigger 在 `auth.users` insert 當下就建 profile（即使尚未驗證）。這符合「profile 1:1 對應 auth.users」；驗收條件「驗證完成後 profiles 存在對應 row」仍成立（更早存在，不違反）。若日後要求「僅驗證後才建 profile」，再改用 confirm 事件，但目前選項 A 最穩妥，且 orchestrator 建議 A。
- `SECURITY DEFINER` 函式的 owner 需能 insert `public.profiles`；migration 由 owner 套用即可，無需額外 grant。

## Implementation Steps

0. **先讀框架文件（強制，AGENTS.md 最上方警告）**：這是破壞性版本的 Next.js 16，寫任何 route handler / cookie 程式碼前，developer 必讀：
   - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
   - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`
   已由 architect 確認的關鍵事實：
   - route handler 簽名：`export async function POST(request: Request) { ... }`，回傳 `Response.json(...)` 或 `NextResponse`。
   - **`cookies()` 是 async**：必須 `const cookieStore = await cookies()`。`.set(name, value, options)` / `.delete(name)` 只能在 route handler / server function 內呼叫。
   - 讀 supabase `@supabase/ssr` README（`node_modules/@supabase/ssr/`）確認 `createServerClient` 的 `cookies` 介面（現行為 `getAll` / `setAll`）。

1. **安裝依賴**：`npm install @supabase/supabase-js @supabase/ssr`。安裝後 `package.json` dependencies 應含這兩者。

2. **修正設定與 env**：
   - `supabase/config.toml`：`enable_confirmations = true`。
   - `.env.local`：`SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`（值不變）。
   - 確認 `.env.example` 三個 key 齊全（已齊，無需改）。

3. **建立使用者情境 client** `src/lib/supabase/server.ts`：
   - export `async function createSupabaseServerClient()`。
   - 內部 `const cookieStore = await cookies()`（`import { cookies } from 'next/headers'`）。
   - `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll() { return cookieStore.getAll() }, setAll(list) { list.forEach(({name, value, options}) => cookieStore.set(name, value, options)) } } })`。
   - `@supabase/ssr` 會自動以 httpOnly + SameSite +（production）Secure 設定寫 session cookie；不要手動覆蓋成非 httpOnly。
   - 不在此檔讀 secret key。

4. **建立管理員 client** `src/lib/supabase/admin.ts`：
   - export `function createSupabaseAdminClient()`，用 `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })`。
   - 此 client 不綁 cookie、不持久 session，純供 server 端特權操作。register 用它呼叫 `auth.signUp`（不希望註冊在當前瀏覽器留下任何 session cookie，符合「不自動登入」）。
   - **檔案內加註解**：`SUPABASE_SECRET_KEY` 僅限 server；此模組不得被任何 client component import。

5. **`src/app/api/auth/register/route.ts`（POST）**：
   - 解析 body（`await request.json()`，包 try/catch → 解析失敗回 400）。
   - 輸入驗證（在 API 邊界）：`email`、`password` 必填；email 格式基本檢查；password 長度 ≥ `config.toml` 的 `minimum_password_length`（目前 6）。缺欄位或格式錯 → 400 附清楚訊息，不 500。
   - 用 **admin client** 呼叫 `auth.signUp({ email, password, options: { emailRedirectTo: <SITE_URL>/api/auth/confirm } })`。（`SITE_URL` 從 env，如 `NEXT_PUBLIC_SITE_URL`；若沿用 config `site_url`，developer 於 env 定義並於 confirm 導向重用。）
   - 因 `enable_confirmations = true`，Supabase 回傳 user 但**無 session** → route **不設任何 cookie**。
   - 回傳 200/201 + `{ message: "註冊成功，請至信箱點擊驗證連結完成驗證" }`。
   - **帳號枚舉防護**：重複 email 時 Supabase 行為依專案設定可能回一般化結果；route 一律回相同的「請至信箱查看」訊息，不回「此 email 已存在」。若 Supabase 回錯誤，映射為通用訊息，避免洩漏帳號是否存在。
   - 不 log email 完整值 / password / 任何 token。

6. **`src/app/api/auth/login/route.ts`（POST）**：
   - 解析 + 驗證 body（同上，缺欄位 400）。
   - 用 **使用者情境 client**（`createSupabaseServerClient`）呼叫 `auth.signInWithPassword({ email, password })`。
   - 成功 → `@supabase/ssr` 自動經 `setAll` 寫入 httpOnly session cookie；回 200 + `{ message: "登入成功" }`（可附非敏感的 user id）。
   - 未驗證信箱：Supabase 回 `email_not_confirmed` 類錯誤 → 映射為 403（或 401）+ `{ error: "請先至信箱完成驗證再登入" }`。
   - 帳密錯誤 → 401 + 通用 `{ error: "帳號或密碼錯誤" }`（不透露是帳號不存在或密碼錯，防枚舉）。
   - 不 log password / token / session。

7. **`src/app/api/auth/logout/route.ts`（POST）**：
   - 用 **使用者情境 client** 呼叫 `auth.signOut()` → `@supabase/ssr` 會清除 session cookie。
   - 回 200 + `{ message: "已登出" }`。
   - 即使當前無 session 也回 200（冪等）。

8. **`src/app/api/auth/confirm/route.ts`（GET）**：
   - email 驗證連結 callback。採 **token_hash 流程**（server-side、與 `@supabase/ssr` 相容）：
     - 從 `request` 的 `URL` 讀 `token_hash` 與 `type`（`new URL(request.url).searchParams`）。
     - 用 **使用者情境 client** 呼叫 `auth.verifyOtp({ type, token_hash })`。
     - 成功 → Supabase 交換出 session，經 `setAll` 寫 httpOnly cookie；以 `NextResponse.redirect(<成功頁，如 SITE_URL/>)` 導向（Task 5 前端頁未做，先導向首頁或回可導向的 JSON 結果）。
     - token 過期 / 無效 / 缺參數 → 不 500；回導向錯誤頁或回 400/JSON `{ error: "驗證連結無效或已過期，請重新註冊或重寄驗證信" }`。
   - profile 由 DB trigger 已自動建立，本 route 不碰 profile。
   - 註（設定，非程式碼）：需確保 Supabase confirmation email 模板送出的連結指向 `/api/auth/confirm?token_hash={{ .TokenHash }}&type=email`（或 signup）。若沿用預設 `{{ .ConfirmationURL }}`（指向 `/auth/v1/verify`），改用其 `redirect_to` 落到本 route 亦可，但 token_hash 自訂模板最直接。developer 於 `config.toml` `[auth.email.template.confirmation]` 或 Dashboard 設定，並記錄於手動測試 checklist。

9. **DB trigger migration**：`supabase migration new auth_users_profile_trigger`，填入上方「選項 A」的 SQL。**不自動套用**（延續 Task 1 慣例：由使用者手動 `npm run db:push` 或 Dashboard 執行）。

10. **手動測試 checklist** `supabase/tests/auth_routes_manual.md`：見下方 Test Plan，developer 據此撰寫可複製貼上的 curl 指令與預期結果。

11. **收尾**：`npm run lint` 必須通過（AGENTS.md 要求）。無 TODO、無 debug log、無 commented-out code。

## Data Flow
```
註冊：
  Browser → POST /api/auth/register {email,password}
    → [admin client] auth.signUp (無 session)
    → Supabase 建 auth.users row (unconfirmed)
        └─(DB trigger on_auth_user_created)→ insert public.profiles(id, role='user')
    → Supabase 寄驗證信
    → route 回 200「請收信」，不設 cookie

驗證：
  Browser 點信中連結 → GET /api/auth/confirm?token_hash&type
    → [user client] auth.verifyOtp → 交換 session
    → @supabase/ssr setAll → 寫 httpOnly session cookie
    → redirect 導向

登入：
  Browser → POST /api/auth/login {email,password}
    → [user client] auth.signInWithPassword
    → 成功：setAll → httpOnly cookie；未驗證：403；錯誤：401(通用)

登出：
  Browser → POST /api/auth/logout
    → [user client] auth.signOut → 清 cookie → 200
```

## Test Plan
專案無 Docker、無 JS 測試框架（本 task **不**引入測試框架；若後續要自動化再另立 plan dependency）。採手動測試，寫成 `supabase/tests/auth_routes_manual.md`，內容為 dev server（`npm run dev`）+ 本機 Supabase（`supabase start`）下可執行的 curl / REST client checklist。每項需標「指令 + 預期 status code + 預期 body/行為」。

必涵蓋案例（對照 orchestrator 驗收與 edge case）：
- 註冊：合法 email+密碼 → 200/201，回「請收信」，**回應無 `Set-Cookie` session**。
- 註冊：缺 email 或 password → 400。
- 註冊：無效 email 格式 / 密碼過短 → 400（非 500）。
- 註冊：重複 email → 不洩漏帳號存在（與首次註冊回應一致或通用訊息）。
- 登入（未驗證帳號）→ 403 + 「請先驗證信箱」，無 session cookie。
- 驗證：從本機 Inbucket/`local_smtp`（config port 54324）取驗證連結 → GET /api/auth/confirm → 成功導向、回應含 httpOnly session cookie。
- 驗證：竄改 / 過期 token_hash → 明確錯誤（非 500）。
- 登入（已驗證帳號、正確帳密）→ 200 + httpOnly session cookie（檢查 `Set-Cookie` 含 `HttpOnly`、`SameSite`）。
- 登入：密碼錯 → 401 通用「帳號或密碼錯誤」（不分帳號/密碼）。
- 登入：缺欄位 → 400。
- 登出：帶 session → 200 且 session cookie 被清除（`Set-Cookie` 過期）。
- profile 驗證：註冊後查 `public.profiles` 存在對應 row 且 `role='user'`（可複用 profiles_verify.sql 的查詢思路）。

Unit / integration：本 task 不寫 JS 單元/整合測試（無框架）。route 的驗證邏輯正確性由上述手動 checklist 覆蓋。QA 依此 checklist 靜態/手動驗收（延續 Task 1 模式）。

## Architecture Notes
- **偏離點**：以「手動 checklist」取代自動化測試 — 延續 Task 1 已確立、使用者核可的做法（無 Docker/無測試框架）。QA agent 依 AGENTS.md 仍會標示「0 自動測試覆蓋」，屬已知並接受的狀態。
- **兩個 client 的分工**是刻意設計：register 走 admin client 確保註冊「不自動登入」（不在瀏覽器留 cookie）；login/logout/confirm 走 user client 讓 `@supabase/ssr` 管 cookie。
- **選項 A 的時序**：profile 在 auth.users insert（即註冊當下、未驗證）就建立，早於驗證完成。驗收條件（驗證後存在對應 row）仍滿足。若產品要求「未驗證不得有 profile」，需改策略 — 目前無此要求。
- **風險**：email 模板 / redirect URL 設定錯會導致 confirm 流程斷掉（連結指錯 route）。已在步驟 8 明列並要求寫進手動 checklist 驗證。
- **效能**：route 皆 request-time、無快取（route handler POST 預設不快取；confirm 用動態 API 亦不快取）。無明顯效能疑慮。

## Security Checklist
- [ ] `SUPABASE_SECRET_KEY` 只在 `src/lib/supabase/admin.ts`（server-only）讀取，永不加 `NEXT_PUBLIC_` 前綴、不出現在 client component。
- [ ] 無 hardcoded 密鑰 / 連線字串；全走 env（AGENTS.md）。
- [ ] session cookie 為 httpOnly + SameSite +（production）Secure — 交由 `@supabase/ssr` 處理，不手動降級成可被 JS 讀取。
- [ ] 輸入驗證在 API 邊界（email/password 必填、格式、長度）；壞輸入回 400 非 500。
- [ ] 密碼交給 Supabase Auth（bcrypt），route 不碰明文、不自行儲存。
- [ ] 帳號枚舉防護：login 密碼錯回通用 401；register 重複 email 不洩漏存在與否。
- [ ] 不 log 密碼、token、token_hash、session、完整 email。
- [ ] 未驗證帳號無法取得 session（login 擋、register 不發 session）。
- [ ] `config.toml` 未提交任何真實密鑰；secret 走 `env(...)`。

## Definition of Done
- [ ] 步驟 0–11 全部完成。
- [ ] 4 支 route + 2 支 lib client + 1 支 trigger migration + 手動 checklist 皆建立。
- [ ] `config.toml` `enable_confirmations = true`；`.env.local` key 命名對齊。
- [ ] Test Plan 全部案例寫入 `supabase/tests/auth_routes_manual.md`。
- [ ] `npm run lint` 通過。
- [ ] 無 TODO / commented-out code / debug log。
- [ ] Security Checklist 全數通過。
- [ ] 遵守 AGENTS.md 所有 guardrail（`@/*` alias、lib 放 `src/lib/`、DB client 為指定的 `@supabase/*`、pooled 連線與 env、不 hardcode 密鑰）。
