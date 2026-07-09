# Architect Plan — 建立 /api/profile API (GET/PATCH)

> Story: 會員系統 | Task 3 of 7 | Task type: BACKEND | Generated: 2026-07-09T07:30:00Z
> auth-adjacent：本 task 消費既有 session 機制（未改動 auth 模型），依 AGENTS.md 於 review 階段自動 🔴 Critical 審視。

## Overview

在 `src/app/api/profile/route.ts` 新增 GET/PATCH 兩支 handler：以既有 `createSupabaseServerClient()`（cookie-bound 使用者情境 client）從 session 取得身分，直接查/改 `public.profiles` 自己的 row（RLS 第二道防線自然生效），PATCH 僅允許 `nickname` 欄位並嚴格驗證。

## Task Type Confirmed

BACKEND — 與 orchestrator-output.md 一致，無矛盾。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/app/api/profile/route.ts` | GET（回當前使用者 profile 五欄位）+ PATCH（僅更新 nickname）兩支 route handler |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `supabase/tests/auth_routes_manual.md` | 新增「5. Profile (`GET/PATCH /api/profile`)」段落：登入後 GET/PATCH 成功案例 + 401/400/超長 nickname/非法欄位 fail cases 的 curl 步驟與預期結果 |
| `supabase/tests/insomnia_auth.json` | 在 `resources` 陣列追加 GET profile、PATCH profile（合法）、PATCH 帶 `role`（400）、PATCH nickname 51 字（400）等 request 項目（沿用既有 `_id`/`request_group` 慣例，建議新開 `fld_profile` group） |

## Key Decisions

### 1. 「取當前使用者」helper：先內聯，不抽到 src/lib/

- GET/PATCH 同檔共用一個檔案內部的小 helper（呼叫 `supabase.auth.getUser()`，無 user 則回 401）即可。
- **不現在抽到 `src/lib/`**：Task 4 的 middleware 跑在 Next.js middleware 情境，`@supabase/ssr` 在 middleware 用的是 `NextRequest`/`NextResponse` cookie 綁定模式，與 route handler 的 `next/headers` `cookies()` 綁定不同 — 現在抽出的 helper 到 Task 4 也無法直接複用，屬過早抽象（AGENTS.md：不發明過早 pattern）。Task 4 架構時再決定共用層形狀。

### 2. 資料存取：只用使用者情境 client，不用 admin client — 確認

- `createSupabaseServerClient()` 帶使用者 JWT 查詢 → `profiles_select_own` / `profiles_update_own` RLS policy 生效，天然只碰得到自己的 row（第二道防線）。
- 使用者操作自己的 row，RLS 明確允許，**完全不需要** `createSupabaseAdminClient()`（service role 會 bypass RLS，反而削弱防線）。route.ts 不得 import `@/lib/supabase/admin`。

### 3. nickname 清空的正規化

- `null` 與 `""` 皆視為「清空」；寫入 DB 前將 `""` 正規化為 `null`（schema `nickname text` 可 null），DB 內清空狀態單一表示。回傳給前端即 `nickname: null`。

### 4. 長度計算

- 「50 字」以 Unicode code point 計（`[...nickname].length`），避免 emoji/罕用字以 UTF-16 單位計數造成中文使用者困惑。上限 50，超過 → 400。

## Implementation Steps

1. 建立 `src/app/api/profile/route.ts`。頂部 `import { createSupabaseServerClient } from "@/lib/supabase/server";`。定義常數 `const PROFILE_COLUMNS = "id, nickname, role, created_at, updated_at";`、`const NICKNAME_MAX_LENGTH = 50;`，以及中文錯誤訊息常數（風格對齊 `src/app/api/auth/login/route.ts` 的 `GENERIC_LOGIN_ERROR` 做法），建議：未登入 401 →「請先登入」、找不到 row 404 →「找不到會員資料」、body 非 JSON →「請求格式錯誤」（沿用 login 同字串）、非法欄位 →「僅允許更新 nickname」、nickname 不合法 →「nickname 須為字串且長度不可超過 50 字」。
2. 檔案內部寫 helper `async function getAuthenticatedUser(supabase)`（或等效內聯邏輯）：呼叫 `supabase.auth.getUser()`；`error` 或 `!data.user` → 回 `null`。呼叫端據此回 `Response.json({ error: "請先登入" }, { status: 401 })`。身分**只**來自此處 — 兩支 handler 皆不得從 query string、body、header 讀取任何 user id。
3. 實作 `export async function GET()`（Next 16 簽名已確認；GET 用不到 request 參數可省略）：
   1. `const supabase = await createSupabaseServerClient();`
   2. 驗身分 → 無 user 回 401。
   3. `supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle()`。
   4. 查詢 `error` → 500（`{ error: "伺服器錯誤" }`，server 端 `console.error` 只記 error code/message，不含 token/session/email）。
   5. `data === null`（異常：DB trigger 應已建 row）→ 404 `{ error: "找不到會員資料" }`，並 `console.error` 記 user id（非敏感）以便排查 — 明確處理，不默默回空。
   6. 成功 → `Response.json(data, { status: 200 })`（即五欄位物件）。
4. 實作 `export async function PATCH(request: Request)`，驗證順序（**先驗身分再驗 body**，未登入一律 401 優先）：
   1. `const supabase = await createSupabaseServerClient();` → 驗身分 → 無 user 回 401。
   2. `await request.json()` 以 try/catch 包裹（風格同 login route）→ 失敗回 400「請求格式錯誤」。
   3. body 必須是 plain object（`typeof === "object" && !== null && !Array.isArray`），否則 400。
   4. **白名單整包拒絕**：`Object.keys(body)` 必須恰好等於 `["nickname"]` — 帶任何其他 key（含 `role`/`id` 等）→ 400「僅允許更新 nickname」，不更新任何東西。空物件 `{}`（缺 `nickname` key）同樣 400（符合驗收「空 body → 400」）。
   5. 型別/長度驗證：`nickname` 須為 `string` 或 `null`，否則 400；為 string 且 `[...nickname].length > NICKNAME_MAX_LENGTH` → 400。
   6. 正規化：`nickname === ""` → `null`。
   7. `supabase.from("profiles").update({ nickname }).eq("id", user.id).select(PROFILE_COLUMNS).maybeSingle()`。（`updated_at` 由 DB trigger `profiles_set_updated_at` 自動更新 — route 不手動塞。）
   8. `error` → 500（同 GET 的 log 規則）；`data === null`（RLS 拒絕或 row 不存在的異常）→ 404「找不到會員資料」。
   9. 成功 → `Response.json(data, { status: 200 })`（更新後五欄位）。
5. 更新 `supabase/tests/auth_routes_manual.md`：新增 profile 段落（沿用既有 curl `-b cookies.txt` 帶 session 的寫法），案例見 Test Plan。
6. 更新 `supabase/tests/insomnia_auth.json`：追加 profile requests（成功 GET/PATCH + 非法欄位 + 超長 nickname + 未登入），命名沿用「編號. METHOD 說明」格式。
7. `npm run lint` 與 `npx tsc --noEmit` 通過後才算完成。

## Data Flow

```
Client (帶 httpOnly session cookie)
  → GET/PATCH /api/profile (route handler)
    → createSupabaseServerClient()  [綁 cookies()，使用者 JWT]
    → supabase.auth.getUser()       [身分唯一來源；失敗 → 401]
    → supabase.from("profiles")…eq("id", user.id)
        [第一道: route 只用 session 的 user.id]
        [第二道: RLS profiles_select_own / profiles_update_own]
    → PATCH 時 DB trigger profiles_set_updated_at 更新 updated_at
  ← Response.json(profile 五欄位 / { error: 中文訊息 })
```

## Test Plan

無 Docker、不安裝測試框架（延續 Task 1/2 已核可做法）— 手動測試。

- **手動 checklist**（`supabase/tests/auth_routes_manual.md` 新段落，逐條對應驗收條件）：
  1. 未登入 GET → 401。
  2. 未登入 PATCH → 401。
  3. login 後 GET → 200，body 恰含 `id`/`nickname`/`role`/`created_at`/`updated_at` 五欄位，`role = "user"`。
  4. PATCH `{"nickname":"新名字"}` → 200 回更新後 profile；Studio 查 DB 確認 `updated_at` 已由 trigger 更新（大於 `created_at`）。
  5. PATCH `{"nickname":""}` 與 `{"nickname":null}` → 200，回傳 `nickname: null`。
  6. PATCH nickname 51 字 → 400（checklist 提供現成 51 字字串）。
  7. PATCH `{"nickname":"x","role":"admin"}` 及 `{"role":"admin"}` → 400，Studio 確認 `role`、`nickname` 皆未變。
  8. PATCH `{}`、非 JSON body、`{"nickname":123}` → 400。
  9. 安全斷言：以使用者 B 的 cookie 無任何方式讀/改使用者 A（無參數可指定 id）；嘗試 `?id=<A的id>`（應被忽略、仍回自己資料）與 body 帶 `id`（應 400）皆無法越權。
- **Insomnia**（`supabase/tests/insomnia_auth.json`）：追加 GET profile、PATCH profile（合法）、PATCH 帶 `role`（fail case）、PATCH 超長 nickname（fail case）、未登入 GET 等 requests。
- Edge cases 來源：orchestrator-output.md「Edge Cases / Notes for QA」全數涵蓋（查無 row 走 404 明確處理；清空允許；不 log token/session）。

## Architecture Notes

- **無 pattern 偏離**：沿用 Task 2 的 route handler 結構、`Response.json` + 中文 `error` 訊息、常數化訊息字串、try/catch JSON 解析風格。
- Next.js 16（破壞版本）已於 Task 2 確認：`cookies()` 為 async、handler 簽名 `export async function GET/PATCH(request: Request)`；本次再對照 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`，原生 `Request`/`Response.json` 用法不變。
- 404 vs 500 抉擇（spec 留給 architect）：查無 row 採 **404**（語意正確：資源不存在），但因屬異常（trigger 應保證存在）須 server 端 log 以便排查。
- 效能：單 row 主鍵查詢/更新，無 N+1、無分頁需求，無特別考量。
- 風險：`update … select().maybeSingle()` 在 RLS 拒絕時回 0 rows 而非 error — 已以 404 分支明確處理，不會誤判成功。

## Security Checklist

- [ ] No hardcoded secrets or credentials（Supabase URL/key 皆走 env，經既有 lib 讀取）
- [ ] Input validation implemented at system boundaries（PATCH body：JSON 解析、plain object、key 白名單整包拒絕、型別、長度）
- [ ] Auth/permission checks in place（兩支 handler 進入即 `auth.getUser()`；未登入 401）
- [ ] No sensitive data logged（不 log token/session/cookie/email；error log 僅 code/message/user id）
- [ ] 身分不可由參數指定：user id 只來自 `supabase.auth.getUser()`，query/body/header 中的任何 id 不進入查詢條件；body 帶 `id` 直接 400（白名單）
- [ ] RLS 第二道防線確認生效：使用 user-context client（`server.ts`），**禁止** import admin client；`profiles_select_own`/`profiles_update_own` policy 對本 route 的查詢實際套用
- [ ] Auth-adjacent 變更已標記（AGENTS.md：PR Reviewer 自動 🔴 Critical 審視）— 本 task 消費既有 session 機制，未改動 auth 模型

## Definition of Done

- [ ] All implementation steps complete
- [ ] 手動測試文件兩份（checklist + Insomnia 匯入檔）已更新且涵蓋全部驗收條件與 fail cases
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows all rules in AGENTS.md（`@/*` alias、env 變數、無 admin client 濫用）
- [ ] `npm run lint` 與 `npx tsc --noEmit` 通過
- [ ] Security checklist passed
