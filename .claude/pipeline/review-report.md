# Code Review Report — 會員點數系統與商店頁 / Task 1 [BACKEND] 點數資料層
> Generated: 2026-07-17 | Review iteration: 1
> 性質:補件驗證 review — 標的為 commit 5c6c7d7 中的 `supabase/migrations/20260716080000_create_points.sql` 與工作樹新增的 `supabase/tests/points_data_layer_manual.md`。

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
Migration 設計品質高:append-only ledger + SUM(delta) 導出餘額、ref_id unique 承擔冪等、RLS select-own、trigger 贈點與 backfill 皆與 architect plan / AC 一致,且 12 項雲端探測 + trigger 即時探測全數 PASS。auth-adjacent 的 `handle_new_user` 改動以 🔴 等級檢視後無安全問題(SECURITY DEFINER + `search_path=''` + 全限定名 + 冪等 insert,trigger 綁定未被 drop、由即時探測證實仍生效)。僅有兩項 🟡:privilege 層防線與 migration 註解不符(Supabase default privileges 實際上有 grant 寫入權,目前僅靠 RLS 單層擋下)、checklist 缺 UPDATE/DELETE 拒絕探測。

## AGENTS.md Auth-Critical Rule — Explicit Applicability Determination
AGENTS.md:「Any change touching auth, session, or `DATABASE_URL` handling is automatically 🔴 Critical.」

**Determination: 適用 — `handle_new_user()` 是綁在 `auth.users` 上的 trigger function,本 migration 以 `create or replace` 改寫之。** 依規以 🔴 等級逐項檢視:
- `create or replace` 完整保留 profiles 建立行為(對照 `supabase/migrations/20260709033436_auth_users_profile_trigger.sql` 原始版本逐行核對:僅追加 ledger insert,原 insert 語句與 on conflict 行為原封不動)。
- 原 migration 的 `create trigger on_auth_user_created` 綁定未被 drop;`create or replace function` 不影響既有 trigger 綁定,且雲端即時探測(臨時帳號 createUser → 50 點 + profiles 列立即出現)證實鏈路完整。
- SECURITY DEFINER 搭配 `set search_path = ''`,且所有物件全 schema 限定(`public.profiles`、`public.point_transactions`)— 無 search_path 注入面。
- 兩個 insert 皆 `on conflict do nothing`,trigger 重放安全;若 insert 意外失敗,exception 會 abort 整個 auth.users insert(fail-closed,不會產生無 bonus 的半殘帳號)。
- 不涉及 session、cookie、`DATABASE_URL`;migration 內無任何憑證。
- **結論:檢視 PASS,無 Critical finding。**

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — privilege 層與註解/AC 文字不符:authenticated 實際持有 INSERT 權限,防線僅剩 RLS 單層
- **File**: `supabase/migrations/20260716080000_create_points.sql:27-28, 58`
- **Issue**: 註解宣稱「不 grant insert/update/delete — 寫入僅 service_role」,但 Supabase 專案對 `public` schema 有預設的 `ALTER DEFAULT PRIVILEGES`(新表自動 grant ALL 給 anon/authenticated/service_role)。證據就在本次驗證結果裡:authenticated insert 被拒的錯誤是 `new row violates row-level security policy`(RLS 層),而非 `permission denied`(privilege 層)— 代表 INSERT privilege 存在,只是 RLS 無 insert policy 而擋下。兩行 `grant select` 實為冗餘;AC3 的「不 grant」在 privilege 層並未成立。
- **Impact**: 行為面正確(寫入確實被拒,已由雲端探測證實),故非 Critical;但防禦只剩單層 — 未來任何人加了一條寬鬆的 insert/update policy,privilege 層不會兜底。且註解與現實不符會誤導 task 2/3 的開發。
- **Suggested fix**: 新增小 migration:`revoke insert, update, delete on public.point_transactions, public.point_orders from anon, authenticated;`(defense-in-depth,並使註解成立),migration 內註明緣由。

### Issue 2 — checklist 缺 UPDATE/DELETE 拒絕探測
- **File**: `supabase/tests/points_data_layer_manual.md:11-16`
- **Issue**: RLS/權限段只探測 SELECT 與 INSERT;authenticated 對兩表的 UPDATE/DELETE 未列入探測 — ledger 的 append-only 性質最怕的正是竄改/刪除既有列。目前靠「無 update/delete policy」擋下,但無回歸項目守著。
- **Suggested fix**: checklist 增列:登入者 `update point_transactions`(應 0 rows / 拒絕)、`delete from point_transactions`(同上),orders 同理;Issue 1 的 revoke 落地後,預期錯誤會從 RLS 靜默 0 筆變成 permission denied,一併記入預期結果。

## 💡 Suggestions (Consider — No Action Required)
1. **`ref_id` 允許 NULL**(`create_points.sql:16`):unique 對 NULL 不去重,未帶 ref_id 的列會繞過冪等機制。目前兩個寫入方(trigger、backfill)都帶 ref_id,無實害;若日後所有 reason 都有自然冪等鍵,可考慮改 `not null`。
2. **`point_orders.provider_txn_id` 無 index / unique**:task 2 webhook 若以 provider_txn_id 反查訂單,屆時建議補 index(冪等已由 ledger `ref_id='order:{id}'` 承擔,unique 非必要)。
3. **`point_orders` 的 `on delete cascade`**:刪帳號連帶刪付款訂單紀錄 — mock 階段合理且與專案 cascade 慣例一致;接真金流(ECPay)後宜重新評估留存需求(對帳/稽核)。

## Security Assessment
- Secrets scan: PASS(migration 與 checklist 皆無任何憑證;checklist 明示憑證取自 `.env.local` / `.env.playwright.local`,符合「勿硬編」規範)
- Input validation: PASS(check constraints:`delta <> 0`、reason/status/provider 白名單、amount_twd/points > 0)
- Auth/authz: PASS(RLS enable + select-own policy、`(select auth.uid())` initplan 寫法正確、service_role 僅存於伺服端;auth trigger 專項檢視 PASS — privilege 層備註見 🟡 Issue 1)
- Test coverage: 手動 checklist 12 項 + trigger 即時探測,覆蓋全部 6 條 AC(缺口見 🟡 Issue 2)

## Plan Compliance
- [x] All architect plan steps implemented(Step 1 靜態核對、Step 2-4 雲端探測全 PASS、Step 5 checklist 已產出)
- [x] Implementation matches plan intent(plan 列的兩個風險點 — profiles 行為保留、trigger 綁定未失效 — 均已由即時探測排除)
- [x] No unauthorised scope additions(migration 內容嚴格對應 AC1-AC6;commit 5c6c7d7 其餘檔案屬 task 2/3 範圍,不在本次審查標的)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡 Issue 1(revoke 補強 migration) | 待 developer 處理 — 行為已證實正確,不阻擋 pipeline | 移交,QA 階段追蹤 |
| 🟡 Issue 2(checklist 增 update/delete 探測) | 待 developer 處理 | 移交,QA 階段追蹤 |
