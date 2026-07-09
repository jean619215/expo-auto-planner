import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();

  // 冪等：即使當前無 session，signOut 仍會清除 cookie 並成功回應。
  await supabase.auth.signOut();

  return Response.json({ message: "已登出" }, { status: 200 });
}
