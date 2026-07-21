import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AI_CHAT_COST } from "@/lib/ai/client";
import { getBalance } from "@/lib/points/ledger";

const NOT_LOGGED_IN_ERROR = "請先登入";

// 面板展開即呼叫(AC5):回扣點值(固定成本,來自 server env)與目前餘額。
// 受 src/proxy.ts fail-closed 保護(不進 PUBLIC_API_PATHS)— 回應含使用者
// 個人餘額,route 內仍自行 getUser() 做 defense in depth,同 chat route。
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }

  const balance = await safeBalance(userData.user.id);

  return Response.json({ chatCost: AI_CHAT_COST, balance }, { status: 200 });
}

async function safeBalance(userId: string): Promise<number | null> {
  try {
    return await getBalance(userId);
  } catch (err) {
    console.error(
      "GET /api/ai/config 餘額查詢失敗",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
