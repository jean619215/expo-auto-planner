-- 在 auth.users 新增時，自動於 public.profiles 建立對應 row (role 預設 'user')。
-- 讓 profile 建立完全交給 DB 層處理，不依賴應用層記得呼叫，永不漏建。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- 需以 owner 權限寫入 public.profiles（跨 schema、繞過 RLS）
set search_path = ''        -- 鎖死 search_path，防 search_path 注入
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;   -- 冪等，重放安全
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
