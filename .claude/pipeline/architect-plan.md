# Architect Plan — /api/auth/resend 重寄驗證信

> Story: 會員系統 | Task 8 of 9 | Task type: BACKEND | Generated: 2026-07-11T02:30:00Z

## Overview

新增公開 route `POST /api/auth/resend`,包 `supabase.auth.resend({ type: "signup" })` 重寄 signup 驗證信;完全複製 register 的防枚舉模式 (輸入錯誤 400,其餘一律 200 + 同一句通用訊息,status + body 完全一致),Supabase 錯誤 (含 429) 只記 server log 且不含 email。同時把 route 加進 proxy 白名單、將本地 `config.toml` 的 email `max_frequency` 調為 60s。

## Task Type Confirmed

BACKEND — 與 orchestrator-output.md 一致,無矛盾。純 API route + 設定檔,無 UI (前端按鈕/倒數為 Task 9)。

⚠️ Auth-adjacent change (AGENTS.md 規則):本 task 觸及 auth route 與 proxy 白名單,PR review 階段自動列 🔴 Critical 審視範圍,屬預期,非 escalation 事由。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/app/api/auth/resend/route.ts` | `POST /api/auth/resend` route handler:驗證 body、呼叫 `supabase.auth.resend`、防枚舉通用回應 |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/proxy.ts` | `PUBLIC_API_PATHS` Set 加一行 `"/api/auth/resend"`。**只加這一行** — `config.matcher` 已含 `/api/:path*`,涵蓋此路徑,不需動;其餘邏輯零改動 |
| `supabase/config.toml` | `[auth.email]` 區塊 (現第 230 行) `max_frequency = "1s"` → `"60s"` |
| `supabase/tests/auth_routes_manual.md` | 追加 resend 測試段落 (見 Test Plan) |
| `supabase/tests/insomnia_auth.json` | 追加 `POST /api/auth/resend` 請求 (合法 email 一組即可,body `{"email":"..."}`,對齊既有 collection 結構) |

## Client 選擇定案 (orchestrator 留給 architect 的決策)

**用 `createSupabaseServerClient()` (`src/lib/supabase/server.ts`,anon/publishable key)。不用 admin。**

依據:
1. supabase-js 的 `auth.resend()` 打的是 GoTrue **公開** `/resend` endpoint — 瀏覽器端 anon client 本來就能呼叫,不需要 service_role 權限。`@supabase/supabase-js@2.109` 的 `GoTrueClient.resend({ type, email, options })` 完整支援 `type: "signup"` 與 `options.emailRedirectTo`。
2. 最小權限原則 (AGENTS.md security rules):非必要不用 `admin.ts`。register 用 admin 是 `signUp` 當時的刻意決策,不構成 resend 的先例。
3. server client 綁 cookies 在此無副作用:resend 不回傳 session、不會寫任何 auth cookie;proxy 的 `updateSession` 對公開路徑照常刷新既有 session,互不干擾。
4. AGENTS.md 模組化規則:一律用 `src/lib/supabase/` 工廠,不 inline 建 client — 兩個現成工廠中 server.ts 即滿足,故選它。

## Implementation Steps

1. **建立 `src/app/api/auth/resend/route.ts`** — 整體結構逐段對齊 `src/app/api/auth/register/route.ts`:
   - 頂部常數:
     - `EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (與 register 同一支 regex)
     - `GENERIC_RESEND_MESSAGE = "若該信箱已註冊且尚未驗證，驗證信已重新寄出"` (Backend 契約指定字串,一字不差 — Task 9 前端依賴)
   - `export async function POST(request: Request)`:
     a. `await request.json()` 包 try/catch,parse 失敗 → `400 {"error":"請求格式錯誤"}` (非 JSON body 不得 500 — QA edge case)。
     b. 結構驗證:body 非 object / null / 無 `email` → `400 {"error":"缺少 email"}`;`email` 非 string 或空字串 → 同上 400。
     c. `EMAIL_REGEX` 不符 → `400 {"error":"email 格式錯誤"}`。
     d. `const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;` — emailRedirectTo 只來自 env,絕不取自 request。
     e. `const supabase = await createSupabaseServerClient();` (import 自 `@/lib/supabase/server`;注意此工廠是 async,要 await — 與 register 用的同步 admin 工廠不同)。
     f. 呼叫:
        ```ts
        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: siteUrl
            ? { emailRedirectTo: `${siteUrl}/api/auth/confirm` }
            : undefined,
        });
        ```
        `emailRedirectTo` 與 register 完全一致 (`${siteUrl}/api/auth/confirm`),重寄的信走同一 confirm 流程。
     g. **防枚舉 (Task 2 QA 教訓 — status code 也是洩漏管道)**:`error` 與成功兩分支**必回同一 status 200 + 同一 body** `{"message": GENERIC_RESEND_MESSAGE}`。error 分支先 `console.error` 一行:
        `[auth/resend] resend error: status=... code=... message=...`
        (格式對齊 register;只含 status/code/message,**絕不含 email**。429 rate limit 亦走此分支,對外不可區分。)
     h. 加註解說明防枚舉理由 (成功/失敗/429 status+body 一致) 與 server log 保留排查能力,對齊 register 檔內既有註解風格。

2. **修改 `src/proxy.ts`** — `PUBLIC_API_PATHS` Set 內加 `"/api/auth/resend",` (放在 `"/api/auth/logout"` 之後即可)。確認事項:`config.matcher` 的 `"/api/:path*"` 已涵蓋此路徑,**不修改 matcher**;檔內其餘任何邏輯不動。

3. **修改 `supabase/config.toml`** — `[auth.email]` 區塊內 `max_frequency = "1s"` → `max_frequency = "60s"` (伺服器端冷卻:60 秒內對同一 email 重複 resend 會被 GoTrue 以 429 拒絕 → 被本 route 的 error 分支吞成通用 200)。
   - ⚠️ **此檔只影響本地 Docker stack (`supabase start`)。雲端專案必須由人工在 Supabase Dashboard 設定**:Authentication → Rate Limits → email 相關項目 (「Minimum interval between emails」/ email 寄送頻率) 設為 60 seconds。開發者無法用程式碼完成雲端這步 — 在交付訊息中提醒使用者。
   - 另註:`[auth.rate_limit] email_sent = 2`/hr 為既有值,與本 task 無關,不動。

4. **更新 `supabase/tests/auth_routes_manual.md`** — 追加 resend 段落 (內容見 Test Plan)。

5. **更新 `supabase/tests/insomnia_auth.json`** — 加一個 `POST {base_url}/api/auth/resend` 請求,JSON body `{"email": "..."}`,命名與結構對齊既有 auth 請求。

6. **驗證**:`npm run lint`、`npx tsc --noEmit`、`npm run build` 全過。route handler 模式沿用既有 auth routes (Next.js 16 已驗證可行),不引入新 framework API。

## Data Flow

```
Client ── POST /api/auth/resend {email}
   │
   ▼
src/proxy.ts ── updateSession (session 刷新) ── pathname ∈ PUBLIC_API_PATHS → 放行 (未登入可呼叫)
   │
   ▼
src/app/api/auth/resend/route.ts
   ├─ JSON parse / email 驗證失敗 ──────────────→ 400 {error}
   └─ createSupabaseServerClient().auth.resend(type:"signup", email, emailRedirectTo=SITE_URL/api/auth/confirm)
        │
        ▼ GoTrue /resend (受 max_frequency 60s 冷卻)
        ├─ 成功 → 寄驗證信 (連結導回 /api/auth/confirm) ─┐
        └─ 錯誤/429 → console.error(status/code/message) ─┴→ 一律 200 {message: 通用訊息} (status+body 完全一致)
```

## Test Plan

無 JS 測試框架 (AGENTS.md) — 手動 checklist + Insomnia,無自動測試。BACKEND task,無 playwright 階段。

**`supabase/tests/auth_routes_manual.md` 追加「resend」段落**,至少含:

- 已註冊未驗證 email → 200 通用訊息,且本地 mail 介面 (port 54324) 可看到重寄的驗證信,信內連結指向 `/api/auth/confirm`,點擊可完成驗證。
- **防枚舉核心斷言:不存在的 email → 與上一項的 response「status code + body 逐字完全一致」**(checklist 明寫要比對兩者的 status 與 body 原始字串,不是「看起來差不多」)。
- 已驗證的 email → 同樣 200 同一句訊息 (Supabase 不寄信,對外不可區分)。
- 60 秒內對同一 email 連打兩次 → 第二次對外仍 200 同一句訊息;server console 有 `[auth/resend]` 錯誤 log,**log 內含錯誤碼但不含 email**;本地 mail 介面確認第二封信未寄出。
- 缺 email → 400;email 格式錯 (如 `abc`) → 400;非 JSON body → 400 非 500。
- 未登入 (無 cookie) 直接呼叫 → 非 401 (proxy 白名單生效)。
- 回歸:register/login/confirm/logout 既有 checklist 抽測,確認 proxy 改動無影響。

**Insomnia**:`insomnia_auth.json` 加 resend 請求一則。

## Architecture Notes

- 無模式偏離:route 結構、錯誤 shape (`{error}` / `{message}`)、繁中訊息、client 工廠、proxy 白名單機制全部沿用既有慣例。
- 與 register 的唯一刻意差異:client 用 server (anon) 而非 admin — 依據見「Client 選擇定案」,屬降權而非升權。
- 已知風險:雲端 rate limit 需 Dashboard 人工設定 (config.toml 管不到),若漏設,雲端 resend 冷卻依 Supabase 預設值而非 60s — 需人工跟進。
- 效能:單次外部呼叫,無 DB 查詢,無需考量。

## Security Checklist

- [ ] 無 hardcode secrets/連線字串 — 只讀 `NEXT_PUBLIC_SITE_URL` 與工廠內既有 env
- [ ] 輸入驗證在邊界完成 (JSON parse、型別、email regex → 400)
- [ ] 防枚舉:成功 / 不存在 / 已驗證 / 429 四種情況對外 **status 200 + 同一 body,完全一致**
- [ ] server log (`console.error`) 只含 error status/code/message,**不含 email**、token、session、cookie
- [ ] `emailRedirectTo` 固定由 env 組成 (`${NEXT_PUBLIC_SITE_URL}/api/auth/confirm`),不含任何使用者輸入 — 無 open redirect
- [ ] 未引入 `admin.ts` / service_role — 本 route 全程 anon 權限
- [ ] proxy 白名單僅加 exact path 一項,fail-closed 語義不變

## Definition of Done

- [ ] 所有 Implementation Steps 完成
- [ ] manual checklist resend 段落 + Insomnia resend 請求已加入
- [ ] `npm run lint`、`npx tsc --noEmit`、`npm run build` 通過
- [ ] 無 TODO、註解掉的程式碼、debug log
- [ ] 符合 AGENTS.md 全部規則 (工廠 client、`@/*` alias、防枚舉、不 log 敏感資料)
- [ ] Security Checklist 全數通過
- [ ] 交付訊息包含「雲端 Dashboard 需人工設 rate limit 60s」提醒
