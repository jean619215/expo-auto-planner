# Architect Plan — 場地規劃 AI 助理 / Task 1

> Task: [BACKEND] 點數 ledger 支援 AI 扣點 — reason constraint migration + 扣點 helper
> 性質:新實作(小型資料層任務)

## Step 1 — Migration `2026xxxx_allow_ai_usage_reason.sql`
```sql
alter table public.point_transactions
  drop constraint point_transactions_reason_check;
alter table public.point_transactions
  add constraint point_transactions_reason_check
  check (reason in ('signup_bonus', 'purchase', 'ai_usage'));
```
- 先查雲端實際 constraint 名稱(可能是自動命名)再寫,避免 drop 不存在的名稱。
- 推雲端:session pooler(ap-southeast-1:5432,經驗:transaction pooler 6543 撞 prepared statement 錯誤;直連 IPv6 不通)。push 需使用者執行或授權。

## Step 2 — Helper `src/lib/points/ledger.ts`(server-only)
- `getBalance(userId)`:admin client select delta sum(與 balance route 同語意;balance route 是 user-context + RLS,helper 是 admin + 明確 userId — 註解說明差異)。
- `deductPoints({userId, amount, reason, refId})`:
  1. 驗 amount 為正整數(否則 throw — 程式錯誤,非業務錯誤)。
  2. getBalance < amount → `{ok:false, error:'insufficient_balance'}`。
  3. insert `{user_id, delta: -amount, reason, ref_id: refId}`;錯誤碼 23505 → `{ok:false, error:'duplicate'}`;其他錯誤 throw。
  4. 成功 `{ok:true}`。
- 檔頭註解:server-only 警告(service_role)+ 併發透支取捨說明。
- **不改** balance route 去共用 getBalance — 該 route 走 RLS 防線,語意不同,不硬抽象(AC3 不破壞既有)。

## Step 3 — 驗證
1. Migration 探測(node 腳本,service_role):插 `ai_usage` 成功(隨即清理)、插 `bogus` reason 被 check 擋。
2. Helper 實測腳本(strip-types 直跑 .ts,同 task 2 守門探測做法):
   - getBalance 與 balance API 數字一致
   - 扣點成功 → 餘額遞減,ledger 出現負 delta 列
   - 餘額不足 → 拒絕且無寫入
   - 同 refId 重扣 → `duplicate`,ledger 仍一筆
   - 全部測試列清理
3. `tsc --noEmit` + `npm run lint` + 全套 Playwright 迴歸(AC3)。
4. checklist:`supabase/tests/points_data_layer_manual.md` 追加 ai_usage 段落。

## Escalation 檢查
- schema 變更 = 一條 check constraint 放寬,無資料遷移。無 API contract 變更。非 auth-adjacent(不碰 trigger/RLS/grant)。無 escalation。

## 產出物
- migration 檔、`src/lib/points/ledger.ts`、checklist 更新、scratchpad 驗證腳本(不進 repo)
