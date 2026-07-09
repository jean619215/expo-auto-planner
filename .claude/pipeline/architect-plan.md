# Architect Plan — 建立 profiles 資料表 + RLS policy

> Story: 會員系統 | Task type: BACKEND | Generated: 2026-07-09

## Overview
用 Supabase CLI 管理 schema：把 `supabase` 加為 dev dependency 並 `init` 本地設定，然後寫一支 forward migration 建立 `public.profiles` 表（PK/FK 到 `auth.users`）、啟用 RLS，並加上 SELECT/UPDATE/INSERT 三條「本人限定」policy。本 task 只做 schema + RLS，不含 API route 與前端。

## Task Type Confirmed
BACKEND

## Reconciliation Note (讀我)
`state.json.current_task` 仍寫「建立 Supabase 專案…」，但 orchestrator-output.md（已確認的細化規格）明確指出雲端專案已由使用者建好、`.env.local` 已填，本 task **不建立**雲端專案，只產出 schema/RLS migration 並驗證可套用。**本計畫以 orchestrator-output.md 為準。**

## Auth-Adjacent Flag (依 AGENTS.md 安全規則)
本 task 觸及 auth 領域：`profiles.id` FK 到 `auth.users(id)`、RLS policy 使用 `auth.uid()`。AGENTS.md 記載 auth approach 為未定 open question，但：
- `.env.example` 已列出 Supabase Auth 專用 key（publishable / secret key），
- orchestrator 已與使用者確認採 Supabase（含 `auth.users` 作為使用者來源）。
因此本 task 實質上把 auth 來源定為 **Supabase Auth**。此為既有決定的延伸，非新決策，**不需升級人工**，但 reviewer 會依 AGENTS.md 將任何 auth/DATABASE_URL 相關變更視為 🔴 Critical 審視 —— developer 請特別注意本清單的 Security Checklist。

## Files to Create
| File path | Purpose |
| --------- | ------- |
| `supabase/config.toml` | Supabase CLI 本地設定（由 `supabase init` 產生，需 commit；含 `project_id`，無密鑰） |
| `supabase/.gitignore` | 由 `supabase init` 產生，忽略 `.branches` / `.temp` 等本地暫存（需 commit） |
| `supabase/migrations/<timestamp>_create_profiles.sql` | 建立 `profiles` 表 + 啟用 RLS + 三條 policy（+ updated_at trigger） |
| `supabase/tests/profiles_rls.test.sql` | pgTAP 驗收測試（見 Test Plan；若不引入 pgTAP 則改用手動驗證 script，見替代方案） |

## Files to Modify
| File path | What changes |
| --------- | ------------ |
| `package.json` | `devDependencies` 加入 `supabase`（CLI）；`scripts` 加入 `db:push`、`db:reset`、`db:test`、`db:diff` 等便捷指令 |
| `package-lock.json` | 隨 `npm install` 自動更新（不手改） |

> 不需修改 `.gitignore`：root `.gitignore` 已用 `.env*`（保留 `.env.example`）涵蓋任何 `supabase/.env`；`supabase init` 另會產生 `supabase/.gitignore` 管理本地暫存檔。安裝後請 developer 目視確認沒有任何 `supabase/.env` 或含密碼的檔案被 git 追蹤。

## Implementation Steps

1. **安裝 Supabase CLI 為 dev dependency（不要全域安裝）**
   在專案根目錄執行：
   ```bash
   npm install --save-dev supabase
   ```
   後續一律以 `npx supabase ...` 呼叫，確保團隊版本一致、CI 可重現。（不要用 `npm i -g supabase`，不要用 brew 全域裝。）

2. **初始化本地 Supabase 設定**
   ```bash
   npx supabase init
   ```
   產生 `supabase/config.toml` 與 `supabase/.gitignore`。若出現「generate VS Code settings / Deno」等提問一律選 `N`（本 task 不需要）。確認 `supabase/config.toml` 產生成功。

3. **建立 migration 檔（用 CLI 產生正確命名）**
   ```bash
   npx supabase migration new create_profiles
   ```
   會建立空檔 `supabase/migrations/<YYYYMMDDHHMMSS>_create_profiles.sql`。**務必用此指令產生**，時間戳前綴是 Supabase 判定套用順序的依據，不要手動命名。

4. **填入 migration SQL** — 將以下內容寫入步驟 3 產生的檔案（完整 SQL 見下方「Table SQL」「RLS SQL」「updated_at trigger SQL」三段，依序貼上）。

5. **本地驗證 migration 可套用** — 依環境二擇一（見下方「Local Verification」段），確認表、欄位、RLS、policy 都如預期建立。

6. **撰寫驗收測試** — 依「Test Plan」建立 `supabase/tests/profiles_rls.test.sql`（pgTAP，首選）或手動驗證 script（無 Docker 替代）。

7. **加入 npm scripts** — 於 `package.json` `scripts` 加入：
   ```json
   "db:diff": "supabase db diff",
   "db:reset": "supabase db reset",
   "db:push": "supabase db push",
   "db:test": "supabase test db"
   ```
   讓後續 task 與 CI 有一致入口。

8. **執行 lint 收尾** — `npm run lint` 確認未破壞既有 TS/ESLint（本 task 不動 TS，但依 AGENTS.md 完成前一律跑 lint）。

## Table SQL
貼入 migration 檔（`public` schema）：
```sql
create table public.profiles (
  id         uuid        primary key
                         references auth.users (id) on delete cascade,
  nickname   text,
  role       text        not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is '會員 profile，1:1 對應 auth.users';
comment on column public.profiles.role is 'user（預設）/ 未來可擴充 curator 等';
```
設計說明：
- `id` 同時是 PK 又是 FK → `auth.users(id)`，`on delete cascade` 滿足「刪 auth.users 連帶刪 profiles」的驗收條件。
- 不新增獨立 surrogate key；未來其他表/storage path 一律以 `profiles.id`(= `auth.users.id`) 作 `user_id` 參照，符合 orchestrator 的命名慣例。
- 保留擴充空間：日後加 `preferences jsonb` 等欄位屬 additive migration，不需重構。

## RLS SQL
```sql
alter table public.profiles enable row level security;

-- SELECT：只能讀自己的 row
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ( (select auth.uid()) = id );

-- UPDATE：只能改自己的 row（using 檢查舊列、with check 檢查新列）
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- INSERT：只能插入 id = 自己 uid 的 row
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ( (select auth.uid()) = id );

-- 不建立 DELETE policy：帳號刪除不在本 task 範圍（RLS 預設 deny）。
```
說明：
- 用 `(select auth.uid())`（子查詢包裹）是 Supabase 官方建議的效能寫法（讓 planner 快取為 initplan，避免逐列呼叫）。
- 限定 `to authenticated`：匿名角色不落入 policy、預設被拒。
- 這是**第二道防線**：伺服器端 API route 用 secret key（service_role）會 bypass RLS 來建 profile；RLS 確保即便帶著使用者 JWT 直連，也只能碰自己的資料。

## updated_at trigger SQL（建議納入，schema 層級）
orchestrator 設計含 `updated_at`，但只給 default 無法在 UPDATE 時自動更新。加一個 trigger 讓它正確：
```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();
```
> 若 reviewer/使用者認為超出「schema + RLS」最小範圍，可移除此段而不影響驗收條件；architect 建議保留，因屬 low-risk 且避免日後補寫。

## Local Verification
Supabase CLI 有兩種套用路徑，**差別在要不要 Docker**：

**方案 A — 本地 Docker（首選，最安全，不碰雲端資料）**
需 Docker Desktop 運行中。
```bash
npx supabase start          # 啟動本地 Postgres + 服務（首次會拉 image）
npx supabase db reset       # 依 migrations 重建本地 db 並套用本 migration
```
接著用 `npx supabase db reset` 的輸出確認無錯誤，並執行驗證查詢（見下）。完成後 `npx supabase stop`。

**方案 B — 無 Docker，推到遠端專案（次選）**
先連結雲端專案（project ref 取自 `NEXT_PUBLIC_SUPABASE_URL` 的子網域）：
```bash
npx supabase link --project-ref <project-ref>
npx supabase db push          # 套用尚未套用的 migrations 到遠端
```
- `link` / `db push` 需要資料庫密碼，CLI 會**互動式提示**輸入，或讀 `SUPABASE_DB_PASSWORD` 環境變數 —— **不要**把密碼寫進任何 commit 檔。可先 `npx supabase db push --dry-run` 檢視將執行的 SQL。
- 注意連線埠差異：`db push`/`link` 走 migration 用途，Supabase CLI 內部使用**直連**（5432）而非 pooled；這與 AGENTS.md「serverless runtime 一律 pooled(6543)」不衝突 —— 那條規範針對「應用程式在 serverless function 內的連線」，一次性 migration 由 CLI 管理不受此限。應用層（後續 task 的 API route）仍必須用 `-pooler`/6543 的 `DATABASE_URL`。

**驗證查詢（兩方案皆適用，用 psql 或 Supabase SQL editor）**
```sql
-- 表與欄位存在
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='profiles'
order by ordinal_position;

-- RLS 已啟用
select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;  -- 應為 t

-- policy 存在
select policyname, cmd from pg_policies
where schemaname='public' and tablename='profiles';  -- 應有 3 條
```

## Test Plan
純 SQL/migration task 的驗收採「斷言 migration 結果」而非傳統單元測試。

**首選：pgTAP（`supabase test db`）—— 不需 npm 套件，Supabase 本地 stack 已內建，但需 Docker（方案 A）。**
建立 `supabase/tests/profiles_rls.test.sql`，涵蓋：
- Schema 斷言：`has_table('profiles')`、`has_column` × 5、`col_default_is('profiles','role','user')`、`col_is_pk`、FK 存在且為 `on delete cascade`。
- RLS 斷言：`is(relrowsecurity, true)`、`policies_are('profiles', ...)` 三條齊全。
- 行為斷言（核心）：模擬兩個使用者驗證隔離 —
  ```sql
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<userA-uuid>"}';
  -- 只看得到自己的 row，看不到 userB 的 row
  -- 嘗試 update/insert userB 的 row 應被 RLS 擋下（0 rows affected / error）
  ```
  執行：`npx supabase test db`。

> **Plan dependency（明確標示）**：pgTAP 走 Supabase 本地 stack，依賴 Docker。專案目前 0 測試框架，本 task **不新增 JS 測試框架（Jest/Vitest 皆不裝）**，改用 Supabase 內建 pgTAP —— 這是本專案第一個測試機制，最小且與 DB 綁定。QA agent 請以此 test file 作為新邏輯的覆蓋依據。

**無 Docker 替代方案**：若環境無 Docker，改交付 `supabase/tests/profiles_rls_manual.sql` —— 一支用 `DO $$ ... raise exception ...$$` 或 `assert` 做斷言、可用 `psql "$DATABASE_URL"` 對遠端跑的驗證 script，覆蓋上述同樣的 schema/RLS/隔離檢查。此為降級方案，developer 依實際環境擇一並在交付說明註記採用哪個。

**必測邊界（來自 orchestrator-output edge cases）**：
- 刪除 `auth.users` 一列 → 對應 `profiles` 列被 cascade 刪除。
- 未指定 `role` 時預設為 `'user'`。
- 已登入使用者無法 SELECT/UPDATE 他人 profile 列（RLS 隔離）。

## Data Flow
本 task 無 runtime 資料流（純 schema）。定義後的關係：
```
auth.users (Supabase Auth 管理)
   │  id (uuid)
   └──1:1──> public.profiles.id  (PK+FK, on delete cascade)
                     ▲
        RLS: authenticated 角色僅能存取 auth.uid() = id 的列
        (後續 task) API route 用 SUPABASE_SECRET_KEY(service_role) bypass RLS 建立 profile
```

## Architecture Notes
- **不引入 ORM**：符合已確認決定，schema 純以 SQL migration 版控。developer 依 AGENTS.md 不得臨時加 Prisma/Drizzle。
- **CLI 版本鎖定**：以 devDependency 安裝，避免不同機器 CLI 版本產生 migration 差異。
- **direct vs pooled 連線**：migration（CLI，一次性）用直連是正常且正確的；AGENTS.md 的 pooled 規範是針對「應用 runtime 的 serverless 連線」，兩者不衝突（已在 Local Verification 說明）。
- **updated_at trigger** 屬建議性擴充，可被裁掉，見該段說明。
- **風險/複雜度**：低。唯一外部依賴是 Docker（僅方案 A/pgTAP 需要）；若 CI 或本機無 Docker，走方案 B + 手動驗證 script。

## Security Checklist
- [ ] 無任何 hardcode secret / token / 密碼（含 DB 密碼、service_role key）—— migration、config.toml、npm scripts 皆不得出現真值
- [ ] 連線資訊一律走環境變數 / CLI 互動提示；`DATABASE_URL` 不寫死、不 commit（root `.gitignore` 已擋 `.env*`）
- [ ] `supabase/config.toml`、`supabase/.gitignore` 確認不含密鑰後才 commit
- [ ] RLS 已 enable 且三條 policy 限定 `to authenticated` + `auth.uid() = id`（第二道防線到位）
- [ ] 目視確認沒有 `supabase/.env` 或含密碼檔被 git 追蹤（`git status` / `git ls-files supabase/`）
- [ ] 不在任何地方 log DB 連線字串或 JWT claims
- [ ] auth-adjacent 變更已於本計畫明確標示，交 reviewer 依 AGENTS.md 🔴 Critical 標準審視

## Definition of Done
- [ ] `supabase` 已為 devDependency，`supabase init` 完成，`config.toml` 存在
- [ ] `supabase/migrations/<ts>_create_profiles.sql` 建立 `profiles`（5 欄、PK、FK cascade、role 預設 user）+ 啟用 RLS + 3 條 policy（+ 選用 updated_at trigger）
- [ ] migration 在本地（方案 A）或遠端 dry-run/push（方案 B）成功套用，驗證查詢通過
- [ ] `supabase/tests/profiles_rls.test.sql`（或手動替代 script）覆蓋 schema + RLS 隔離 + 三個 edge case
- [ ] npm scripts 已加入
- [ ] 無 TODO、無註解掉的程式碼、無 debug log
- [ ] 通過本文件 Security Checklist
- [ ] `npm run lint` 通過
