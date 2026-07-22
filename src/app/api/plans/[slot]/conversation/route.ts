import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const NOT_LOGGED_IN_ERROR = "請先登入";
const INVALID_SLOT_ERROR = "存檔格位不正確";
const NOT_FOUND_ERROR = "找不到存檔";
const SERVER_ERROR = "伺服器錯誤";

type Slot = 1 | 2 | 3;

// 複製自 ../route.ts(非抽共用)— 對齊 AGENTS.md「route 內 validation
// inline、尚未抽 service layer」慣例,見 architect-plan.md D8。
function parseSlot(param: string): Slot | null {
  if (param === "1") return 1;
  if (param === "2") return 2;
  if (param === "3") return 3;
  return null;
}

async function requireUser(): Promise<{ userId: string } | { response: Response }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { response: Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 }) };
  }
  return { userId: data.user.id };
}

// 清空該格 AI 對話:刪整列 ai_conversations,cascade 帶走 ai_messages
// (architect-plan.md D8 / orchestrator-output.md Assumption 4)。無對話列
// 時刪除影響 0 列仍回 200(冪等)。
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<"/api/plans/[slot]/conversation">,
) {
  const { slot: slotParam } = await ctx.params;
  const slot = parseSlot(slotParam);
  if (slot === null) {
    return Response.json({ error: INVALID_SLOT_ERROR }, { status: 400 });
  }

  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const admin = createSupabaseAdminClient();
  const { data: plan, error: planError } = await admin
    .from("venue_plans")
    .select("id")
    .eq("user_id", userId) // ★ admin client 無 RLS,此過濾為安全關鍵
    .eq("slot", slot)
    .maybeSingle();

  if (planError) {
    console.error(
      "DELETE /api/plans/[slot]/conversation 查詢失敗",
      planError.code,
      planError.message,
    );
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }
  if (!plan) {
    return Response.json({ error: NOT_FOUND_ERROR }, { status: 404 });
  }

  const { error: deleteError } = await admin
    .from("ai_conversations")
    .delete()
    .eq("plan_id", plan.id);

  if (deleteError) {
    console.error(
      "DELETE /api/plans/[slot]/conversation 刪除失敗",
      deleteError.code,
      deleteError.message,
    );
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  return Response.json({ slot, cleared: true }, { status: 200 });
}
