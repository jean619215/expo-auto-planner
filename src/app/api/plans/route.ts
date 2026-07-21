import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const NOT_LOGGED_IN_ERROR = "請先登入";
const SERVER_ERROR = "伺服器錯誤";

const SLOTS = [1, 2, 3] as const;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }
  const userId = userData.user.id;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("venue_plans")
    .select("slot, name, updated_at")
    .eq("user_id", userId) // ★ admin client 無 RLS,此過濾為安全關鍵
    .order("slot", { ascending: true });

  if (error) {
    console.error("GET /api/plans 查詢失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  // 固定回傳 3 元素陣列(slot 1/2/3 全列),不管是否占用 — 前端不用自己補洞。
  const bySlot = new Map(data.map((row) => [row.slot, row]));
  const slots = SLOTS.map((slot) => {
    const row = bySlot.get(slot);
    return row
      ? { slot, occupied: true, name: row.name, updatedAt: row.updated_at }
      : { slot, occupied: false, name: null, updatedAt: null };
  });

  return Response.json({ slots }, { status: 200 });
}
