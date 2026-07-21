# Architect Plan — venue_plans migration + 儲存檔 API 五支

> Story: 場地儲存檔與 AI 對話持久化 | Task type: BACKEND | Generated: 2026-07-22T02:20:00+08:00

## Overview

新增 `venue_plans` 表(單一 migration,含 RLS/grant/revoke/updated_at trigger)與兩個 route 檔共五支 API(`/api/plans` 列表 + `/api/plans/[slot]` 讀/存/改名/刪),寫入僅 service_role、應用層以 `.eq("user_id", userId)` 強制隔離。本 task 不建對話表、不動 `/api/ai/chat`;讀檔 API 的 `conversation` 固定回 `[]` 佔位。

## Task Type Confirmed

BACKEND — 與 orchestrator-output.md 一致,技術分析無矛盾。

## Escalation Check(通過,不升級)

- 無外部 API 契約變更(全部是自家新路由)。
- 新表 migration,不影響既有資料(無 ALTER 既有表)。
- 不動 auth/session/`DATABASE_URL`;proxy.ts 零修改(`/api/:path*` matcher 已涵蓋,fail-closed 預設保護,新路由非 public 不需進 allowlist)。
- 複雜度符合 story 切分。資訊充分,可完整規劃。
- 注意:含新 RLS policy 與 grant/revoke — 非 AGENTS.md 自動 Critical 項,但涉跨使用者隔離,review 階段列高關注(見 Security Checklist)。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `supabase/migrations/20260722020000_create_venue_plans.sql` | `venue_plans` 表 + index + RLS select-own + revoke 寫入權 + updated_at trigger(單檔含 revoke,新表無歷史包袱) |
| `src/app/api/plans/route.ts` | `GET /api/plans` 列表(固定 3 格概況) |
| `src/app/api/plans/[slot]/route.ts` | `GET`/`PUT`/`PATCH`/`DELETE` 四支單格操作(專案第一個動態段 API route) |
| `supabase/tests/venue_plans_api_manual.md` | 手動驗證 checklist(curl 腳本流程,逐條對應 AC) |
| `supabase/tests/venue_plans_verify.sql` | SQL 驗證腳本(表結構/constraint/RLS/grant-revoke) |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| (無) | 不動 `src/proxy.ts`(matcher 已涵蓋)、不動 `src/lib/ai/`、不動既有 migrations |

## Implementation Steps

### Step 1 — Migration:`supabase/migrations/20260722020000_create_venue_plans.sql`

全文設計(developer 照抄,僅時間戳依實際建檔時間調整):

```sql
-- 場地儲存檔:每人 3 格 (slot 1–3),一格 = 一份配置 jsonb 快照 + 名稱。
--
-- 設計原則(比照 point_transactions 慣例):
-- * 三格上限由 DB 硬保證:check (slot between 1 and 3) + unique (user_id, slot),
--   非應用層計數;未來「點數解鎖更多格」只需放寬 check。
-- * 寫入僅 service_role(API route 內 admin client);authenticated 只能讀自己的。
--   明確 revoke insert/update/delete — Supabase default privileges 對新表會
--   grant anon/authenticated 完整 CRUD(20260717010000 踩過的坑),不依賴預設。
-- * updated_at 由 DB trigger 維護,沿用 profiles 的 public.set_updated_at()。

create table public.venue_plans (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  slot        smallint    not null check (slot between 1 and 3),
  name        text        not null default '未命名場地',
  plan        jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, slot)
);

comment on table public.venue_plans is '場地儲存檔:每人 3 格,plan 為 polygon/walls/columns/furniture 整包快照';
comment on column public.venue_plans.slot is '格位 1–3,unique(user_id, slot) + check 硬保證上限';

create index venue_plans_user_id_idx on public.venue_plans (user_id);

alter table public.venue_plans enable row level security;

-- 只開放讀自己的;寫入僅 service_role(bypass RLS)。
grant select on public.venue_plans to authenticated;

create policy "venue_plans_select_own"
  on public.venue_plans
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- grant 層 + RLS 雙層防禦:明確拔掉 default privileges 給的寫入權。
revoke insert, update, delete on public.venue_plans from anon, authenticated;

-- updated_at trigger:重用 20260708173519 建立的 public.set_updated_at()
-- (該 function 已存在於 DB,不重複定義)。
create trigger venue_plans_set_updated_at
  before update on public.venue_plans
  for each row
  execute function public.set_updated_at();
```

- **重用而非新建** `set_updated_at()`:`20260708173519_create_profiles.sql` 已建立(`set search_path = ''`),本 migration 只掛 trigger。不需要 `security definer`(trigger function 只改 NEW record,不跨表寫入 — 與 profiles 用法一致)。
- **不執行 push**:sandbox 擋 `supabase db push`(session pooler 前例)。developer 產出檔案即止,由使用者手動執行,見 Test Plan 的驗證步驟。

### Step 2 — `src/app/api/plans/[slot]/route.ts`:共用私有 helpers(檔內,不抽 lib)

依 AGENTS.md「validation + response logic inline、無 service layer」慣例,helpers 以 module-private function 放在 route 檔內(route 檔只 export HTTP method,私有 function 不違反慣例)。列表 route 不需要 slot 解析,故不需跨檔共用、不建 `src/lib/plans/`。

檔案頂部常數(比照 `/api/points/balance` 的字串常數慣例):

```ts
const NOT_LOGGED_IN_ERROR = "請先登入";      // 401
const INVALID_SLOT_ERROR  = "存檔格位不正確"; // 400
const INVALID_PLAN_ERROR  = "存檔格式錯誤";   // 400(plan 形狀 / body 非 JSON)
const EMPTY_NAME_ERROR    = "名稱不可為空";   // 400(PATCH)
const NOT_FOUND_ERROR     = "找不到存檔";     // 404
const SERVER_ERROR        = "伺服器錯誤";     // 500
```

私有 helpers:

1. `parseSlot(param: string): 1 | 2 | 3 | null` — 嚴格白名單:`param === "1" ? 1 : param === "2" ? 2 : param === "3" ? 3 : null`(字串比對,不用 `Number()` 以免 `"1.0"`、`" 1"`、`"1e0"` 漏網)。null → 各 handler 回 400,**不查 DB**。
2. `requireUser(): Promise<{ userId: string } | { response: Response }>` — `createSupabaseServerClient()` + `auth.getUser()`,失敗回 401 Response(defense in depth,proxy 已擋一層,比照 `/api/ai/config`)。
3. `isValidPlanShape(plan: unknown): boolean` — phase 1 形狀基本檢查(inline,不做深度 schema、不驗幾何):
   - `plan` 是 plain object(非 null、非 array);
   - `polygon`/`walls`/`columns`/`furniture` 四 key 皆存在且 `Array.isArray`;
   - `polygon.length >= 3`(對齊 `MIN_FLOOR_VERTICES`,可 `import { MIN_FLOOR_VERTICES } from "@/lib/venue/plan"` 取常數 — 純 domain module 無 React,server 可安全 import),每元素為 object 且 `typeof x/y === "number"` 且 `Number.isFinite`;
   - `walls`/`columns`/`furniture` 每元素為 object 且 `typeof el.id === "string"`(不驗 w/h/center/幾何欄位 — 刻意寬鬆邊界)。
4. `readJsonBody(request: Request): Promise<unknown | null>` — `request.json()` try/catch,parse 失敗回 null(caller 回 400)。

動態段參數(Next.js 16,本專案第一個動態 API route,依 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`):**`ctx.params` 是 Promise,必須 `await`**。用 typed helper:

```ts
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/plans/[slot]'>) {
  const { slot: slotParam } = await ctx.params;
  ...
}
```

(`RouteContext` 為全域型別,`next dev`/`next build`/`next typegen` 時生成;developer 若 typecheck 找不到型別,先跑 `npx next typegen`。)

### Step 3 — `GET /api/plans/[slot]`(讀檔)

順序:`parseSlot` → 400|`requireUser` → 401|admin client 查詢:

```ts
admin.from("venue_plans")
  .select("slot, name, plan, updated_at")
  .eq("user_id", userId)   // ★ admin client 無 RLS,此過濾為安全關鍵,每個查詢必帶
  .eq("slot", slot)
  .maybeSingle();
```

- error → 500(log `error.code`/`error.message`,比照 balance route)。
- data null → 404 `{"error":"找不到存檔"}`(不區分「沒存過」vs「別人的」,防資訊洩漏)。
- 200:`{ slot, name, plan, updatedAt: data.updated_at, conversation: [] }` — **`conversation` 本 task 硬編碼 `[]`**(空陣列非 null;task 2 換成真查詢,response 形狀不變)。加註解標明 task 2 接手點。

### Step 4 — `PUT /api/plans/[slot]`(upsert 存檔,全量覆蓋)

順序:`parseSlot` → 400|`requireUser` → 401|`readJsonBody` 失敗 → 400 `INVALID_PLAN_ERROR`|body 驗證:

- `plan` 必填,過 `isValidPlanShape`,失敗 → 400 `INVALID_PLAN_ERROR`。
- `name` 可選:`typeof name === "string" && name.trim() !== ""` 時取 `name.trim()` 納入 payload;否則(未帶/空字串/非字串)**不放入 payload**。
- **name 保留語意的實作決定**(orchestrator 留給 architect 的點):不需要 pre-SELECT 也不需要 coalesce — PostgREST `upsert` 的 `on conflict do update` **只 SET payload 中出現的欄位**:`name` 不在 payload 時,insert 情境套 DB default `未命名場地`,conflict-update 情境原 name 不動。一次呼叫同時滿足兩個 AC。developer 需在程式碼註解記錄此依賴。

```ts
const payload: { user_id: string; slot: number; plan: unknown; name?: string } =
  { user_id: userId, slot, plan };
if (trimmedName) payload.name = trimmedName;

admin.from("venue_plans")
  .upsert(payload, { onConflict: "user_id,slot" })
  .select("slot, name, updated_at")
  .single();
```

- `plan` 為 jsonb 整包 replace(全量快照,無 merge);update 時 `updated_at` 由 trigger 更新。
- error → 500。200:`{ slot, name, updatedAt }`(不回整包 plan)。
- API 無條件覆蓋 — 已占用格確認彈窗是 task 3 純前端行為,此處不做二次確認。
- 併發:後寫贏(upsert + unique 天然處理),不加鎖(phase 1 明定取捨)。
- name 不設長度上限(phase 1 明定)。

### Step 5 — `PATCH /api/plans/[slot]`(改名)

順序:`parseSlot` → 400|`requireUser` → 401|`readJsonBody` 失敗或 `typeof body.name !== "string"` 或 `name.trim() === ""` → 400 `EMPTY_NAME_ERROR`。

```ts
admin.from("venue_plans")
  .update({ name: trimmedName })
  .eq("user_id", userId)
  .eq("slot", slot)
  .select("slot, name, updated_at");
```

- error → 500;回傳陣列長度 0(該格未占用)→ 404;否則 200 `{ slot, name, updatedAt }`。
- 空字串必擋(與 PUT 的「空字串=不改名」語意刻意不同,防止改名 API 繞過 default 清空名稱)。

### Step 6 — `DELETE /api/plans/[slot]`

順序:`parseSlot` → 400|`requireUser` → 401|無 body(不讀 request body):

```ts
admin.from("venue_plans")
  .delete()
  .eq("user_id", userId)
  .eq("slot", slot)
  .select("slot");
```

- error → 500;回傳陣列長度 0 → 404(非冪等成功 — 前端只在顯示占用時給刪除鈕,404 代表 race,值得前端知道去刷新);否則 200 `{ slot, deleted: true }`。
- 單純 delete,不清任何關聯 — task 2 的 `ai_conversations.plan_id` FK cascade 屆時由 DB 處理,**本 task 勿預埋任何對話清理邏輯**(程式碼註解標明)。

### Step 7 — `src/app/api/plans/route.ts`:`GET /api/plans`(列表)

`requireUser`(同款 inline 檢查,兩檔各自持有 — 比照既有各 route 檔自帶 `getUser()` 慣例,不強制抽共用)→ 401|admin client:

```ts
admin.from("venue_plans")
  .select("slot, name, updated_at")
  .eq("user_id", userId)
  .order("slot", { ascending: true });
```

- error → 500。
- 200:程式端組**固定 3 元素**陣列(slot 1/2/3 全列,DB 有列的填 `occupied: true, name, updatedAt`,無列的補 `occupied: false, name: null, updatedAt: null`)— 全新使用者回三格皆空,非 404、非空陣列。
- 不 select `plan`(避免列表載入過重 jsonb),conversation 完全不涉及。

### Step 8 — 手動驗證資產:`supabase/tests/venue_plans_api_manual.md`

比照 `points_api_manual.md` 體例,checklist 逐條對應 orchestrator AC(15 條),含 curl 指令範本:

1. 前置:使用者手動 `supabase db push`(sandbox 擋此指令 — 檔內明寫此步驟由人工執行)+ `venue_plans_verify.sql` 過。
2. 登入取得 cookie(沿用既有手動流程:瀏覽器登入後取 cookie,或 curl 打 `/api/auth/login` 存 cookie jar)。
3. 未登入 × 5 路由 → 401。
4. `PUT` 空格不帶 name → 200 + name=未命名場地;已占用格不帶 name → plan 覆蓋、name 保留;帶 name → 兩者皆更新。
5. `PUT` plan 缺 key / polygon < 3 / body 非 JSON → 400。
6. slot `0`/`4`/`abc` × 各路由 → 400。
7. `GET` 空格 → 404;已存格 → 200 含 plan + `conversation: []`。
8. `GET /api/plans` → 固定 3 元素、occupied 正確;全新帳號三格皆 false。
9. `PATCH` 正常改名 / 空白 name 400 / 未占用 404。
10. `DELETE` → 200 `{deleted:true}`,再 GET 404;未占用 404。
11. 跨使用者:B 帳號 GET slot 1(A 已存)→ 404(驗 query 過濾)。

### Step 9 — SQL 驗證腳本:`supabase/tests/venue_plans_verify.sql`

比照 `profiles_verify.sql` 體例,查詢並人工核對:

- 表存在、欄位型別、`check (slot between 1 and 3)`、`unique (user_id, slot)` constraint 存在(`information_schema` / `pg_constraint`)。
- RLS enabled + `venue_plans_select_own` policy 存在。
- **grant 驗證**:`information_schema.role_table_grants` 中 `authenticated` 對 `venue_plans` 僅剩 SELECT、`anon` 無任何權(對應 AC「authenticated 直接 insert/update/delete 被擋」的 SQL 層驗證)。
- trigger `venue_plans_set_updated_at` 存在且綁 `set_updated_at()`。
- 選做:以 `set role authenticated` 模擬 insert 應噴 permission denied(附註需在 SQL editor 以非 superuser 情境測)。

### Step 10 — Lint + 收尾

- `npx next typegen`(生成 `RouteContext` 型別)→ `npm run lint` 乾淨。
- 確認 `git status` 僅含本 plan 列出的 5 個新檔,零觸及 `src/proxy.ts`、`src/lib/ai/`、既有 migrations。

## Data Flow

```
Client (task 3, 未來)
  │  fetch /api/plans*(cookie 自動帶)
  ▼
src/proxy.ts ── /api/:path* matcher,非 allowlist → 需 session(fail-closed)
  ▼
route handler
  ├─ createSupabaseServerClient() + getUser() ── 401 守門(defense in depth)+ 取 userId
  ├─ parseSlot / isValidPlanShape ── 400 守門(不碰 DB)
  ▼
createSupabaseAdminClient()(service_role,bypass RLS)
  └─ 每個 query 應用層 .eq("user_id", userId) ── 跨使用者隔離的唯一有效防線
  ▼
public.venue_plans
  ├─ check slot 1–3 + unique(user_id, slot) ── 三格上限 DB 硬保證
  ├─ RLS select-own + revoke 寫入 ── 第二道防線(誤用 user-context client 時擋下)
  └─ trigger set_updated_at ── update 時自動更新 updated_at
```

## Test Plan

無 unit/integration 框架(AGENTS.md),BACKEND task 驗證為手動,developer 交付前完成:

- **Migration 驗證**:使用者手動 `supabase db push`(sandbox 擋,不得在 pipeline 內嘗試執行)→ 跑 `supabase/tests/venue_plans_verify.sql` 全項通過。此為 developer → QA 交接的前置人工步驟,developer 在交接訊息中明確請使用者執行。
- **API 手動流程**:`supabase/tests/venue_plans_api_manual.md` 全 checklist 過(對應 15 條 AC + edge cases:非 JSON body、slot 非數字、polygon < 3、全新使用者列表、跨使用者 404)。
- **靜態把關**:`next typegen` + lint 乾淨。
- Playwright 不適用(BACKEND task,pipeline playwright stage 跳過);既有 Playwright 套件不受影響(零前端變更)。

## Architecture Notes

- **首個動態段 API route**:`src/app/api/plans/[slot]/route.ts` 是專案第一個 `[param]` API route。Next.js 16 的 `ctx.params` 為 **Promise**(必 await),用全域 `RouteContext<'/api/plans/[slot]'>` 型別 — 已查證 `node_modules/next/dist/docs`,developer 勿憑訓練資料寫同步 params。
- **PUT name 保留機制依賴 PostgREST upsert 語意**(on conflict update 只 SET payload 出現的欄位)— 若未來改用 raw SQL 或其他 client,此語意需重驗。程式碼註解必須記錄。
- **不建 `src/lib/plans/`**:五支 handler 集中兩檔,helpers 檔內私有即可,遵循「無 service layer」現況;task 2/3 若需共用再抽,不預先抽象。
- 讀檔 `conversation: []` 佔位與 DELETE 不清對話,均以註解標明 task 2 接手點,防止後續 task 誤植或重工。
- 效能:jsonb 快照單格整包讀寫,規模小(≤3 列/人、快照數十 KB 級),`venue_plans_user_id_idx` + unique(user_id, slot) 已足;列表不撈 plan 欄位。

## Security Checklist

- [ ] 無硬編碼 secrets/credentials(admin client 走既有 factory,env 讀取)
- [ ] 邊界輸入驗證:slot 白名單字串比對(不 `Number()`)、plan 形狀檢查、name trim、body JSON try/catch — 全在 route 內、DB 之前
- [ ] Auth 檢查:proxy fail-closed + route 內 `getUser()` 雙重(五支全數)
- [ ] **admin client 每一個 DB 呼叫都帶 `.eq("user_id", userId)`** — 本 task 最關鍵安全點,遺漏即跨使用者洩漏;review agent 逐 query 核對(5 支路由共 5 個 query)
- [ ] 404 不區分「不存在」vs「他人資料」(防資訊洩漏)
- [ ] migration 明確 revoke anon/authenticated 寫入權(不依賴 default privileges 假設)+ RLS select-own 雙層防禦
- [ ] 錯誤 log 僅 `error.code`/`error.message`,不含 token/cookie(plan 無 PII,但維持慣例)
- [ ] `service_role` client 僅在 route handler(server)內 import,無 client component 觸及
- [ ] 不動 auth/session/`DATABASE_URL`;RLS/grant 變更雖非自動 Critical,review 列高關注

## Definition of Done

- [ ] 5 個新檔案建立完成,內容符合本計畫各 step(migration SQL 對齊 Step 1 全文設計)
- [ ] 15 條 AC 全數可由 `venue_plans_api_manual.md` checklist 覆蓋驗證
- [ ] `venue_plans_verify.sql` 覆蓋 constraint/RLS/grant/trigger 驗證
- [ ] `next typegen` + `npm run lint` 乾淨;無 TODO、註解掉的程式碼、debug log
- [ ] 零觸及:`src/proxy.ts`、`src/lib/ai/`、`/api/ai/chat`、既有 migrations、任何 `ai_*`/`point_*` 表
- [ ] 未在 sandbox 內嘗試 `supabase db push`(人工步驟,交接訊息明確告知使用者)
- [ ] Security Checklist 全過
- [ ] 符合 AGENTS.md 全部規則(factories、inline validation、`@/*` alias、中文錯誤訊息 `{ error }` 形狀)
