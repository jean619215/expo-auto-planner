import { createSupabaseServerClient } from "@/lib/supabase/server";

const NOT_LOGGED_IN_ERROR = "請先登入";
const SERVER_ERROR = "伺服器錯誤";
const RECENT_LIMIT = 20;

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }

  // 走 user-context client,RLS select_own 生效 — 只讀得到自己的交易。
  // 餘額 = 全部 delta 加總;交易筆數在本系統規模下直接全取加總即可,
  // 未來量大再改 DB 端聚合(rpc/view)。
  const { data, error } = await supabase
    .from("point_transactions")
    .select("id, delta, reason, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/points/balance 查詢失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  const balance = data.reduce((sum, t) => sum + t.delta, 0);

  return Response.json(
    { balance, transactions: data.slice(0, RECENT_LIMIT) },
    { status: 200 }
  );
}
