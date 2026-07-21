# Orchestrator Output — venue_plans migration + 儲存檔 API 五支
> Story: 場地儲存檔與 AI 對話持久化 | Generated: 2026-07-22T00:00:00+08:00

## Task Type
BACKEND

## 範圍邊界(對齊 task 清單)
本 task 只做 `venue_plans` 表與其 CRUD API。`ai_conversations`/`ai_messages` 表與 `/api/ai/chat` 的 `planId` 整合是 task 2。讀檔 API 的 `conversation` 欄位在本 task 先固定回空值,介面留好給 task 2 填入,不建對話相關表、不動 `/api/ai/chat`。

## Refined Requirement

### 1. Migration:`venue_plans`
新檔案 `supabase/migrations/<timestamp>_create_venue_plans.sql`,慣例比照 `20260716080000_create_points.sql` + `20260717010000_revoke_points_writes.sql`(單檔內含 revoke,不必分兩檔,因為這是新表、沒有「先上線後補 revoke」的歷史包袱)。

```sql
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

create index venue_plans_user_id_idx on public.venue_plans (user_id);

alter table public.venue_plans enable row level security;

grant select on public.venue_plans to authenticated;

create policy "venue_plans_select_own"
  on public.venue_plans
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

revoke insert, update, delete on public.venue_plans from anon, authenticated;
```

- `updated_at` 用 DB trigger 自動維護(掃描既有 migrations 找可重用的 `set_updated_at`/類似 trigger function;沒有就在本 migration 內新建一個,`security definer`、search_path 鎖 `''`,比照 `handle_new_user` 寫法)。
- `name` NOT NULL DEFAULT '未命名場地' 滿足 AC「預設名稱」;前端可送空字串觸發後端 fallback(見下方驗證規則)。
- `plan` 為 jsonb,存整包快照(見下方形狀)。
- 三格上限與唯一性由 `check (slot between 1 and 3)` + `unique(user_id, slot)` DB 硬保證,不在應用層計數。
- 寫入僅 service_role(route handler 用 `createSupabaseAdminClient()`),`authenticated` 只有 select-own — revoke insert/update/delete 明確列出,比照 `20260717010000` 的雙層防禦註解慣例。
- Migration 需人工執行 `supabase db push`(sandbox 環境擋此指令,前例為使用者手動跑)— 本 task 完成後 developer 產出 migration 檔即止,不嘗試在 sandbox 內執行 push。

### 2. plan jsonb 形狀與驗證(phase 1)
快照對齊 `src/components/venue/PlanEditor.tsx` 的 4 個 state 與 `src/lib/venue/plan.ts` / `furniture.ts` 型別:

```ts
interface PlanSnapshot {
  polygon: PlanPoint[];       // FloorPolygon, PlanPoint = { x: number; y: number }
  walls: WallSegment[];       // { id: string; start: PlanPoint; end: PlanPoint }
  columns: Column[];          // { id: string; center: PlanPoint; w: number; h: number }
  furniture: FurnitureItem[]; // { id; kind: "table"|"chair"|"cabinet"; center: PlanPoint; w; h; rotationDeg }
}
```

- **驗證程度(phase 1,明定)**:只做「形狀基本檢查」,不做逐欄位深度 schema 驗證、不驗證幾何合法性(例如 polygon 是否自交、furniture 是否真的在邊界內)。基本檢查規則:
  - `plan` 必須是物件,且 `polygon`/`walls`/`columns`/`furniture` 四個 key 都存在且為陣列(缺任一 key 或型別不對 → 400)。
  - `polygon` 陣列長度需 ≥ 3(對齊 `MIN_FLOOR_VERTICES`),每個元素需有 number 型別的 `x`/`y`。
  - `walls`/`columns`/`furniture` 只驗證「是陣列」+ 每個元素是物件且有 `id: string`,不逐一驗證幾何欄位(w/h/center 型別等)— 信任前端傳來的資料,幾何完整性由前端 domain 函式(`src/lib/venue/`)保證。
  - 驗證失敗 → `400 { error: "存檔格式錯誤" }`。
  - Assumption:這是刻意的寬鬆邊界,深度驗證留待未來若發現偽造/損壞資料問題再加嚴。

### 3. API 路由設計(App Router 慣例)

Assumption(路由設計,無既有前例可直接抄,選用 REST 風格 + slot 為路徑參數,比照 `/api/points/*` 的扁平慣例):

| # | Method | Path | 說明 |
|---|--------|------|------|
| 1 | GET | `/api/plans` | 列表:三格概況 |
| 2 | GET | `/api/plans/[slot]` | 讀檔:單格,含 conversation(本 task 固定 `[]` 佔位) |
| 3 | PUT | `/api/plans/[slot]` | Upsert 存檔:指定格寫入,全量覆蓋 |
| 4 | PATCH | `/api/plans/[slot]` | 改名:僅更新 `name` |
| 5 | DELETE | `/api/plans/[slot]` | 刪除:清空該格 |

`[slot]` 為路徑參數,型別為 `"1"|"2"|"3"` 字串,route handler 內 `Number()` 轉換 + 驗證範圍(非 1/2/3 → 400,不查 DB)。

所有五支路由都受 `src/proxy.ts` 預設保護(fail-closed,`/api/*` 已被 `/api/:path*` matcher 涵蓋,免改 allowlist)。Route handler 內部另做 `getUser()` 雙重檢查(defense in depth,比照 `/api/points/balance` 慣例)— 即使 proxy 已擋,route 自己也要驗證身份才能拿到 `userId` 給 admin client 用。

#### 3.1 `GET /api/plans` — 列表
- Response 200:
```json
{
  "slots": [
    { "slot": 1, "occupied": true,  "name": "羽球場配置", "updatedAt": "2026-07-22T00:00:00Z" },
    { "slot": 2, "occupied": false, "name": null, "updatedAt": null },
    { "slot": 3, "occupied": false, "name": null, "updatedAt": null }
  ]
}
```
- 固定回傳 3 個元素(slot 1/2/3 全列,不管是否占用),前端不用自己補洞。
- 未登入 → 401(`{"error":"請先登入"}`,沿用既有常數字串)。
- 不含 `plan`/conversation 內容(避免列表頁載入過重的 jsonb)。

#### 3.2 `GET /api/plans/[slot]` — 讀檔(含對話)
- Response 200(該格已占用):
```json
{
  "slot": 1,
  "name": "羽球場配置",
  "plan": { "polygon": [...], "walls": [...], "columns": [...], "furniture": [...] },
  "updatedAt": "2026-07-22T00:00:00Z",
  "conversation": []
}
```
- **`conversation` 欄位本 task 固定回傳 `[]`(空陣列,非 null)** — 選空陣列而非 null 是因為前端 AiPanel 消費對話時預期陣列可直接 `.map()`,選 `[]` 讓 task 3 前端串接時不用先判斷 null,task 2 建好 `ai_conversations`/`ai_messages` 後再把這裡換成真實查詢結果,response 形狀不變。
- `slot` 不合法(非 1/2/3)→ 400。
- `slot` 合法但未占用(該使用者該格無資料)→ 404(`{"error":"找不到存檔"}`)— 對齊 AC「跨使用者存取他人 planId 回 404」的同一種「查無資料就 404」語意,不區分「不存在」vs「別人的」以免洩漏資訊。
- 未登入 → 401。

#### 3.3 `PUT /api/plans/[slot]` — Upsert 存檔
- Request body:
```json
{ "name": "羽球場配置", "plan": { "polygon": [...], "walls": [...], "columns": [...], "furniture": [...] } }
```
- `name` 可選:不帶或帶空字串 → 用 DB default `未命名場地`(insert 情境);**update 情境(該格已占用)若 `name` 不帶,則保留原本名稱不變**,不會被 default 覆蓋掉(這是「只存配置、不改名字」的常見前端流程 — Assumption:前端「存檔」動作預設不夾帶改名,改名是獨立的 PATCH)。
- `plan` 必填,走上方「形狀基本檢查」。
- 語意:**全量快照覆蓋**,不做 patch/merge — `plan` 欄位整包 replace,`updated_at` 自動更新(trigger)。
- Upsert 用 admin client `.upsert({ user_id, slot, name, plan }, { onConflict: "user_id,slot" })`;name 為 undefined 時不放進 upsert payload,交由 DB default(insert case)或現有值(update case,需先 SELECT 現有 name 再決定 — 因為 Supabase upsert 沒有「欄位不提供就保留原值」的語意。Architect 決定實作細節:可先讀出舊 name 再帶入 upsert payload,或用 DB 端 `coalesce`,只要滿足「name 不帶時不覆蓋既有名稱」的語意即可)。
- Response 200:`{ "slot": 1, "name": "羽球場配置", "updatedAt": "..." }`(不回整包 plan,前端呼叫端本來就有最新值)。
- 400:`plan` 格式錯誤 / `slot` 不合法。
- 401:未登入。
- **前端已占用格覆蓋確認彈窗是純前端行為**(story AC「已占用格跳確認彈窗」)— API 本身不做二次確認、不擋覆蓋,收到請求就直接 upsert 覆蓋。這代表確認邏輯完全在 task 3(FRONTEND)處理,本 task API 語意就是「無條件覆蓋」。

#### 3.4 `PATCH /api/plans/[slot]` — 改名
- Request body:`{ "name": "新名稱" }`
- `name` 必填、trim 後不可為空字串(空字串 → 400,`{"error":"名稱不可為空"}`)— 避免改名 API 被用來清空名稱繞過 default(存檔 upsert 允許空字串因為那是「不改名」語意,改名 API 語意不同,必須是使用者主動給的有效名稱)。
- 該格不存在(未占用)→ 404。
- Response 200:`{ "slot": 1, "name": "新名稱", "updatedAt": "..." }`。
- 401 / 400(slot 不合法)。

#### 3.5 `DELETE /api/plans/[slot]`
- 無 body。
- 該格不存在 → 404(冪等性 Assumption:刪除已刪除的格視為錯誤而非成功,因為前端只會在「該格顯示為占用」時才給出刪除按鈕,404 代表 race condition,值得前端知道去重新整理列表)。
- Response 200:`{ "slot": 1, "deleted": true }`。
- 401 / 400(slot 不合法)。
- Task 2 補充(本 task 不做,先寫死於此供 architect/developer 知悉不要在本 task 誤植):`ai_conversations.plan_id` 未來會是 FK on delete cascade,所以本 task 的 DELETE 不需要手動清對話 — 那是 task 2 建表時就處理好的 DB 層行為,本 task 的 `venue_plans` 表目前還沒有任何東西依賴它,delete 就是單純 `admin.from("venue_plans").delete().eq("user_id", userId).eq("slot", slot)`。

### 4. 共用工具/慣例
- 每支 route 開頭:`createSupabaseServerClient()` + `getUser()` 驗證(401 沿用 `NOT_LOGGED_IN_ERROR = "請先登入"` 字串常數,可獨立在各檔案或共用一個小 helper — architect 決定是否值得抽,不強制)。
- 拿到 `userId` 後,DB 讀寫一律走 `createSupabaseAdminClient()`(service_role,bypass RLS),並在每個 query 上明確 `.eq("user_id", userId)` 過濾(即使 RLS 用不到,admin client 沒有 RLS,過濾邏輯必須在應用層做 — 這是本 task 安全上最重要的一條,漏掉就是跨使用者洩漏)。
- slot 路徑參數驗證統一寫一個 helper(例如 `parseSlot(param: string): 1|2|3|null`),五支路由共用,避免重複。
- 錯誤回應格式沿用既有慣例:`{ "error": "中文訊息" }`。

## Clarified Acceptance Criteria
- [ ] Given 未登入使用者呼叫任一 `/api/plans*` 路由,when 請求送出,then 回 401 `{"error":"請先登入"}`。
- [ ] Given 已登入使用者呼叫空格的 `PUT /api/plans/[slot]`,when 帶合法 `plan` 且不帶 `name`,then 建立新列,`name` 為 `未命名場地`,回 200 含 slot/name/updatedAt。
- [ ] Given 已登入使用者呼叫已占用格的 `PUT /api/plans/[slot]`,when 帶合法 `plan` 不帶 `name`,then 全量覆蓋 `plan` 但保留原 `name`。
- [ ] Given 已登入使用者呼叫已占用格的 `PUT /api/plans/[slot]`,when 帶合法 `plan` 且帶 `name`,then 全量覆蓋 `plan` 與 `name`。
- [ ] Given `plan` 缺少 `polygon`/`walls`/`columns`/`furniture` 任一 key 或型別錯誤,when 呼叫 `PUT`,then 回 400。
- [ ] Given `slot` 不是 1/2/3(如 0、4、"abc"),when 呼叫任一 `/api/plans/[slot]` 路由,then 回 400,不查 DB。
- [ ] Given 已登入使用者對自己未使用過的格呼叫 `GET /api/plans/[slot]`,when 該格無資料,then 回 404。
- [ ] Given 已登入使用者對自己已存檔的格呼叫 `GET /api/plans/[slot]`,when 讀取成功,then 回 200 含 `plan` 整包快照與 `conversation: []`。
- [ ] Given 已登入使用者呼叫 `GET /api/plans`,when 該使用者有 1 格占用、2 格空,then 回傳固定 3 元素陣列,`occupied` 各自正確。
- [ ] Given 已登入使用者對已占用格呼叫 `PATCH /api/plans/[slot]` 帶合法 `name`,then 名稱更新,`plan` 不變。
- [ ] Given `PATCH` 帶空字串或全空白 `name`,then 回 400。
- [ ] Given `PATCH`/`DELETE` 目標格未占用,then 回 404。
- [ ] Given 已登入使用者對已占用格呼叫 `DELETE /api/plans/[slot]`,then 該列刪除,回 200 `{deleted:true}`,再次 GET 該格回 404。
- [ ] Given `authenticated` 角色的 Postgres session 直接嘗試 insert/update/delete `venue_plans`(繞過 API,模擬跨使用者攻擊向量),then 被 grant revoke 擋下(SQL 層驗證,非 API 測試)。
- [ ] Given 使用者 A 已存檔 slot 1,使用者 B 呼叫 `GET /api/plans/1`,then 回 404(因為 admin client query 有 `.eq("user_id", userB.id)` 過濾,B 查詢的是自己的 slot 1,若 B 沒存過則 404 — 這條驗證的是「query 過濾正確」,而非真的讓 B 看到 A 的資料)。

## Edge Cases to Handle
- `slot` 路徑參數帶非數字字串(如 `/api/plans/abc`)→ 400,不 500。
- `PUT` request body 不是合法 JSON → 400(`request.json()` throw 需 catch)。
- `plan.polygon` 陣列長度 < 3 → 400(對齊 `MIN_FLOOR_VERTICES`)。
- 同一使用者對同一 slot 幾乎同時發送兩個 `PUT`(race condition)→ 不特別處理併發鎖,後寫入的覆蓋先寫入的(DB unique constraint + upsert 天然處理,不需要額外邏輯;等同「後存的贏」,這是可接受的 phase 1 行為,比照 `deductPoints` 註解中「已知取捨」的同等級寬容)。
- `name` 超長字串(如 10000 字)→ 本 task 不設長度上限驗證(Assumption:phase 1 不加,若之後要加,交由未來 task 決定合理上限)。
- `GET /api/plans` 使用者完全沒存過任何格(全新使用者)→ 回三格皆 `occupied:false` 的陣列,不是 404,也不是空陣列。

## Error States
- 401 未登入 → 所有五支路由,`{"error":"請先登入"}`。
- 400 slot 參數不合法 → 所有帶 `[slot]` 的四支路由。
- 400 `plan` 形狀驗證失敗 → `PUT`。
- 400 `name` 空字串 → `PATCH`。
- 400 request body 非合法 JSON → `PUT`/`PATCH`。
- 404 該格對該使用者無資料 → `GET`/`PATCH`/`DELETE`。
- 500 DB 非預期錯誤 → 所有路由,`{"error":"伺服器錯誤"}`,log `error.code`/`error.message`(比照 `/api/points/balance`)。

## Out of Scope
- `ai_conversations`/`ai_messages` 表、`/api/ai/chat` 的 `planId` 整合(task 2)。
- 前端存檔 UI、覆蓋確認彈窗、讀檔確認彈窗、AiPanel 續聊/清空對話/軟上限提示(task 3,FRONTEND)。
- 深度 plan jsonb schema 驗證(僅做形狀基本檢查,見上方明定)。
- 併發鎖/樂觀鎖(後寫覆蓋先寫,不做版本號機制)。
- `venue_plans` 之外任何新表或既有表(`ai_*`、`point_*`)的異動。
- 執行 `supabase db push`(人工手動跑,sandbox 環境擋)。

## Assumptions Made
- 路由設計採 `/api/plans` + `/api/plans/[slot]`(REST 風格,slot 為路徑參數),因為 story 未指定確切路由形狀,由本 orchestrator 依循既有 `/api/points/*` 扁平慣例決定。
- `PUT` 用於 upsert(而非 `POST`),因其語意為「指定 slot 冪等覆蓋」,符合 HTTP PUT 語意;`PATCH` 專用於改名局部更新。
- 讀檔/列表/改名/刪除對「查無資料」一律回 404,不區分「本來沒存」vs「跨使用者」,避免資訊洩漏且與 AC 用詞一致。
- `PUT` 不帶 `name` 時,已存在格保留原名稱、新建格套用 DB default — 這是為了讓「存檔」與「改名」是兩個獨立、不互相污染的操作。
- `plan` jsonb 驗證僅做形狀基本檢查,不做深度個別欄位驗證,對齊 orchestrator prompt 明定的「phase 1:形狀基本檢查即可」。
- name 長度不設上限(phase 1)。
- 併發覆蓋採「後寫贏」,不加版本號/樂觀鎖。

## Security Notes
- **跨使用者存取防護是本 task 最關鍵的安全點**:因為用 admin client(service_role,bypass RLS),所有查詢必須應用層手動 `.eq("user_id", userId)` 過濾,遺漏會導致任一使用者可讀寫他人 `venue_plans`。Review agent 應重點檢查每一支 route 的每一個 DB 呼叫是否都有此過濾。
- RLS + grant revoke 為第二道防線(`authenticated` 角色被 revoke insert/update/delete,只保留 select-own),即使應用層有 bug 誤用非 admin client 寫入也會被 DB 擋下。
- Migration 需比照 `20260717010000_revoke_points_writes.sql` 明確 revoke,不依賴「新表預設沒有 grant」的假設(Supabase 對新表預設會 grant `anon`/`authenticated` 完整 CRUD,這是既有專案已踩過的坑)。
- `plan` jsonb 內容不含 PII、不含使用者輸入的自由文字以外的敏感資訊(除了 `name` 是自由文字),log 錯誤時可安全記錄 error code,不需額外遮罩。
- 不涉及 auth/session/`DATABASE_URL` 變更,但涉及新的 RLS policy 與 grant/revoke — PR Reviewer 的 AGENTS.md 規則只把「auth/session/DATABASE_URL」列為自動 Critical,RLS/grant 變更不在該條硬性規則內,但因涉及跨使用者資料隔離,建議 review agent 依專案慣例仍列高關注項。
