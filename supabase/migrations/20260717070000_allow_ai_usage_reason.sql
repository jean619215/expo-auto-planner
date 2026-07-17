-- 場地規劃 AI 助理 task 1: point_transactions.reason 允許值加入 'ai_usage'
-- (AI 呼叫扣點,ref_id 慣例: ai:{request_id})
-- 既有值 signup_bonus/purchase 不受影響;constraint 實名已對雲端探測確認。

alter table public.point_transactions
  drop constraint point_transactions_reason_check;

alter table public.point_transactions
  add constraint point_transactions_reason_check
  check (reason in ('signup_bonus', 'purchase', 'ai_usage'));
