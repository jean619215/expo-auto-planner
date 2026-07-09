# QA Report — 會員系統 / Task 1：建立 profiles 表 + RLS
> Generated: 2026-07-09T03:00:00Z | QA iteration: 1

## Testing Method
無 Docker / 無自動化測試環境（使用者選擇手動測試）。本次驗收採**靜態驗收**：逐條比對
`supabase/migrations/20260708173519_create_profiles.sql` 與
`supabase/tests/profiles_verify.sql` 內容是否滿足 `orchestrator-output.md` 的驗收條件與
edge case。未實際套用 migration 或連線資料庫執行 SQL。

## Summary
- Test cases executed (static review): 13
- Passed: 13
- Failed: 0
- Blocked: 0

## Recommendation
**APPROVED** — 三項 review Should-Fix 已確認修正到位；驗收條件與 edge case 在靜態層面全數滿足。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Migration file exists under `supabase/migrations/`, valid SQL | ✅ PASS | `20260708173519_create_profiles.sql`，語法檢視無誤（create table / alter / policy / function / trigger 語法皆正確） |
| `profiles` 5 欄位型別/約束正確 | ✅ PASS | `id uuid PK`, `nickname text NULL`, `role text NOT NULL DEFAULT 'user'`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` — 與 orchestrator-output.md 表格逐欄一致 |
| `id` 為 PK 且 FK → `auth.users(id)` ON DELETE CASCADE | ✅ PASS | migration L4-5：`primary key references auth.users (id) on delete cascade` |
| `role` 預設 `'user'` | ✅ PASS | migration L7：`not null default 'user'` |
| RLS enabled | ✅ PASS | migration L15：`alter table public.profiles enable row level security;` |
| 3 條 policy（SELECT/UPDATE/INSERT），`auth.uid() = id` 隔離邏輯正確 | ✅ PASS | L22-41：三條 policy 皆以 `(select auth.uid()) = id` 判斷（`select` 包裝為 Supabase 推薦的效能寫法，語意等價於 `auth.uid() = id`）；UPDATE 同時有 `using` + `with check`，INSERT 只有 `with check`，符合預期 |
| 無 DELETE policy（帳號刪除不在範圍） | ✅ PASS | L43 明確以註解說明，RLS 預設 deny，未建立 DELETE policy |
| Migration 對 forward-only 套用安全（無需 idempotent 包裝） | ✅ PASS | 未使用 `if not exists`，符合 Supabase CLI 以 timestamp 管理套用順序的慣例（review 已確認） |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 刪除 `auth.users` row 會 cascade 移除對應 `profiles` row | ✅ PASS | Schema 層：FK `on delete cascade` 存在（migration L5）。驗證面：`profiles_verify.sql` #8 提供可執行步驟（insert → delete auth.users → 斷言 profiles 0 rows）。因無資料庫連線環境，僅能靜態確認 SQL 語法正確且邏輯完整，未實際執行 |
| `role` 未指定時永遠預設 `'user'` | ✅ PASS | Schema 層：`default 'user'`（migration L7）。驗證面：`profiles_verify.sql` #4 提供可執行步驟（insert 不帶 role → select 斷言 role='user'）。同上，僅靜態確認 |
| RLS 隔離：authenticated 使用者無法 SELECT 他人 profile row | ✅ PASS | `profiles_verify.sql` #9 已從 review 前的散文說明，改為可直接複製執行的 SQL 區塊：`set local role authenticated;` + `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`，模擬 user A 與 user B 兩者，斷言 A 的 session 只能 select 到自己的 row，且 update 他人 row 影響 0 rows。指示明確要求「整段一起執行」（simple query protocol 下多語句會被隱含包在同一交易，`set local` 在此情境下有效跨語句），寫法正確 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| 插入不存在於 `auth.users` 的 `id`（FK 違反） | ✅ PASS（設計層面） | FK 約束會使此類 insert 拋出 foreign key violation，行為正確且為 Postgres 標準行為，migration 未做多餘處理，符合預期（無需自訂錯誤處理，schema-only task） |
| 未帶 JWT / 非 authenticated 角色存取 profiles | ✅ PASS（設計層面） | GRANT 只給 `authenticated`，未 grant 給 `anon`；且 RLS enable 後無 policy 命中即 deny-by-default，anon/未認證存取會被拒 |

## Regression Check
| Feature | Result | Notes |
|---|---|---|
| 其他既有 migration / schema | ✅ PASS | 此為專案第一個 migration，無既有 schema 可能受影響 |
| `.env.example` 未被 migration 變更 | ✅ PASS | 本 task 未觸碰環境變數檔案（git status 顯示的 `.env.example` 變更為既有未提交項目，非本次交付物範圍） |

## Review Should-Fix 修正確認（3 項）
| # | Review 發現 | 修正狀態 | 證據 |
|---|---|---|---|
| 1 | RLS policy 缺對應 `authenticated` GRANT，policy 實質不生效 | ✅ 已修正 | migration L19：`grant select, insert, update on public.profiles to authenticated;`（未 grant delete/anon，與 review 建議一致）。並確認 `config.toml` L24 `auto_expose_new_tables` 確實被註解（預設不 expose），故此 GRANT 為必要修正，非多餘 |
| 2 | `set_updated_at` 函式 search_path 可變（linter 告警風險） | ✅ 已修正 | migration L47：函式宣告已加 `set search_path = ''` |
| 3 | RLS 隔離驗證只有散文說明，無可執行 SQL | ✅ 已修正 | `profiles_verify.sql` #9 已改為完整可執行區塊（seed 兩使用者 + `set local role authenticated` + `request.jwt.claims` 模擬 + select/update 斷言 + cleanup） |

## Security Test
- 敏感資料外洩: **PASS** — migration/verify script/`config.toml` 皆無 hardcode 密鑰或連線字串；`config.toml` 敏感值走 `env(...)`
- 輸入驗證: **N/A** — 純 schema/RLS task，無 API 層輸入面
- Auth 邊界: **PASS** — RLS enable + 3 policy 皆以 `auth.uid() = id` 隔離；GRANT 範圍精準（`authenticated` 才有 select/insert/update，無 delete，無 anon）；未認證或非本人請求皆 deny-by-default

## Bugs Found
無。三項 review Should-Fix 皆確認修正到位，靜態驗收未發現新的缺陷。

## Test Coverage
- New code coverage: N/A（無 test framework，本 task 以 `profiles_verify.sql` 手動驗證腳本作為驗收依據，涵蓋全部 7 項結構檢查 + 3 項行為/edge case 檢查）
- Minimum required: AGENTS.md 現況為「無測試框架，QA 需 flag 無覆蓋的新邏輯」— 本 task 已提供最大程度的手動驗證涵蓋（結構性檢查可靜態確認為正確 SQL；行為性 edge case 因無 DB 連線環境無法實際執行，但腳本本身邏輯正確且可執行）
- Status: **PASS**（於「手動測試」授權範圍內已盡可能覆蓋；建議標記：待使用者實際套用 migration 後，應手動跑一次 `profiles_verify.sql` 全部 9 段以取得執行期確認，本 QA 僅完成靜態驗收）

## Notes / Residual Risk (Low, non-blocking)
- `profiles_verify.sql` 涵蓋了 orchestrator 要求的 3 個 edge case（cascade delete、role 預設、RLS SELECT 隔離），並額外涵蓋 UPDATE 隔離（bonus）。INSERT 隔離（他人無法以非本人 id insert）未在腳本中提供對應斷言範例，但這不在 orchestrator 明列的 edge case 清單內，且 policy 本身邏輯經 review 與本次靜態檢視確認正確 —— 記錄為 Low，不阻擋 sign-off。
- package.json 缺 `db:reset`/`db:test` script（review 已記錄為 💡 Suggestion，非阻擋項），QA 同意不阻擋。
