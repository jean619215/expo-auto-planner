-- Review 🟡 Issue 1 (points task 1): Supabase default privileges 讓 anon/authenticated
-- 對新表持有 insert/update/delete 權限 — RLS 有擋住(無 policy 即拒),但與
-- 20260716080000 migration「寫入僅 service_role」的設計註解不符,且防線只剩 RLS 單層。
-- 明確 revoke,恢復 grant 層 + RLS 雙層防禦;service_role 不受影響(bypass 一切)。

revoke insert, update, delete on public.point_transactions from anon, authenticated;
revoke insert, update, delete on public.point_orders from anon, authenticated;
