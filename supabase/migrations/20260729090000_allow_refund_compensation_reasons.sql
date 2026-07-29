-- 金流審核合規改版:point_transactions.reason 允許值加入 'refund' 與 'compensation'
--
-- 動機:公開的退款政策(/refund)與服務條款(/terms)承諾兩件事 —
--   1. 未使用之方案次數可退款  → 退款核准後需沖銷該筆未使用額度(負 delta,reason='refund')
--   2. 上游服務異常導致生成失敗可補回次數 → 需補發額度(正 delta,reason='compensation')
-- 原本的 CHECK 只允許 signup_bonus/purchase/ai_usage,客服無法在不冒用其他
-- reason 的前提下執行上述動作(冒用會讓交易記錄顯示成「方案購買」而失真)。
--
-- ref_id 慣例(沿用既有的 unique 冪等鍵設計,重放安全由 DB 擋):
--   refund       : 'refund:{order_id}'
--   compensation : 'comp:{ai_request_id}' 或 'comp:{ticket_id}'
--
-- ledger 仍是 append-only:本 migration 不新增可變餘額欄位、不放寬 RLS,
-- authenticated 角色依舊沒有 insert 權限,寫入一律走 service_role (admin.ts)。
-- 既有列不受影響(現存 reason 值全在新的允許集合內)。

alter table public.point_transactions
  drop constraint point_transactions_reason_check;

alter table public.point_transactions
  add constraint point_transactions_reason_check
  check (reason in ('signup_bonus', 'purchase', 'ai_usage', 'refund', 'compensation'));
