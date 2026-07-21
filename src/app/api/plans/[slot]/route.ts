import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MIN_FLOOR_VERTICES } from "@/lib/venue/plan";

const NOT_LOGGED_IN_ERROR = "請先登入";
const INVALID_SLOT_ERROR = "存檔格位不正確";
const INVALID_PLAN_ERROR = "存檔格式錯誤";
const EMPTY_NAME_ERROR = "名稱不可為空";
const NOT_FOUND_ERROR = "找不到存檔";
const SERVER_ERROR = "伺服器錯誤";

type Slot = 1 | 2 | 3;

// 嚴格白名單字串比對,不用 Number() 以免 "1.0"/" 1"/"1e0" 之類的值漏網。
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

// Phase 1:僅做形狀基本檢查,不做深度個別欄位驗證、不驗證幾何合法性。
function isValidPlanShape(plan: unknown): boolean {
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    return false;
  }
  const candidate = plan as Record<string, unknown>;
  const { polygon, walls, columns, furniture } = candidate;

  if (!Array.isArray(polygon) || !Array.isArray(walls) || !Array.isArray(columns) || !Array.isArray(furniture)) {
    return false;
  }

  if (polygon.length < MIN_FLOOR_VERTICES) {
    return false;
  }
  const validPoint = (p: unknown): boolean =>
    typeof p === "object" &&
    p !== null &&
    typeof (p as { x: unknown }).x === "number" &&
    Number.isFinite((p as { x: number }).x) &&
    typeof (p as { y: unknown }).y === "number" &&
    Number.isFinite((p as { y: number }).y);
  if (!polygon.every(validPoint)) {
    return false;
  }

  const validElement = (el: unknown): boolean =>
    typeof el === "object" && el !== null && typeof (el as { id: unknown }).id === "string";
  if (!walls.every(validElement) || !columns.every(validElement) || !furniture.every(validElement)) {
    return false;
  }

  return true;
}

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/plans/[slot]">) {
  const { slot: slotParam } = await ctx.params;
  const slot = parseSlot(slotParam);
  if (slot === null) {
    return Response.json({ error: INVALID_SLOT_ERROR }, { status: 400 });
  }

  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("venue_plans")
    .select("slot, name, plan, updated_at")
    .eq("user_id", userId) // ★ admin client 無 RLS,此過濾為安全關鍵
    .eq("slot", slot)
    .maybeSingle();

  if (error) {
    console.error("GET /api/plans/[slot] 查詢失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: NOT_FOUND_ERROR }, { status: 404 });
  }

  // conversation 本 task 固定回傳 []佔位(非 null)— task 2 建好 ai_conversations/
  // ai_messages 後換成真實查詢結果,response 形狀不變。
  return Response.json(
    { slot: data.slot, name: data.name, plan: data.plan, updatedAt: data.updated_at, conversation: [] },
    { status: 200 }
  );
}

export async function PUT(request: Request, ctx: RouteContext<"/api/plans/[slot]">) {
  const { slot: slotParam } = await ctx.params;
  const slot = parseSlot(slotParam);
  if (slot === null) {
    return Response.json({ error: INVALID_SLOT_ERROR }, { status: 400 });
  }

  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: INVALID_PLAN_ERROR }, { status: 400 });
  }
  const { plan, name } = body as { plan?: unknown; name?: unknown };
  if (!isValidPlanShape(plan)) {
    return Response.json({ error: INVALID_PLAN_ERROR }, { status: 400 });
  }
  const trimmedName = typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;

  // name 保留語意依賴 PostgREST upsert 的 on-conflict-update 只 SET payload 中
  // 出現的欄位:name 不帶時,insert 情境套 DB default「未命名場地」,
  // update 情境原 name 不動。若未來改用其他 client/raw SQL,此語意需重驗。
  const payload: { user_id: string; slot: number; plan: unknown; name?: string } = {
    user_id: userId,
    slot,
    plan,
  };
  if (trimmedName) payload.name = trimmedName;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("venue_plans")
    .upsert(payload, { onConflict: "user_id,slot" })
    .select("slot, name, updated_at")
    .single();

  if (error) {
    console.error("PUT /api/plans/[slot] 寫入失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  return Response.json({ slot: data.slot, name: data.name, updatedAt: data.updated_at }, { status: 200 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/plans/[slot]">) {
  const { slot: slotParam } = await ctx.params;
  const slot = parseSlot(slotParam);
  if (slot === null) {
    return Response.json({ error: INVALID_SLOT_ERROR }, { status: 400 });
  }

  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const body = await readJsonBody(request);
  const name = typeof body === "object" && body !== null ? (body as { name?: unknown }).name : undefined;
  if (typeof name !== "string" || name.trim() === "") {
    return Response.json({ error: EMPTY_NAME_ERROR }, { status: 400 });
  }
  const trimmedName = name.trim();

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("venue_plans")
    .update({ name: trimmedName })
    .eq("user_id", userId)
    .eq("slot", slot)
    .select("slot, name, updated_at");

  if (error) {
    console.error("PATCH /api/plans/[slot] 更新失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }
  if (data.length === 0) {
    return Response.json({ error: NOT_FOUND_ERROR }, { status: 404 });
  }

  const row = data[0];
  return Response.json({ slot: row.slot, name: row.name, updatedAt: row.updated_at }, { status: 200 });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/plans/[slot]">) {
  const { slot: slotParam } = await ctx.params;
  const slot = parseSlot(slotParam);
  if (slot === null) {
    return Response.json({ error: INVALID_SLOT_ERROR }, { status: 400 });
  }

  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  // 單純 delete,不清任何關聯 — task 2 的 ai_conversations.plan_id FK cascade
  // 屆時由 DB 處理,本 task 不預埋任何對話清理邏輯。
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("venue_plans")
    .delete()
    .eq("user_id", userId)
    .eq("slot", slot)
    .select("slot");

  if (error) {
    console.error("DELETE /api/plans/[slot] 刪除失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }
  if (data.length === 0) {
    return Response.json({ error: NOT_FOUND_ERROR }, { status: 404 });
  }

  return Response.json({ slot, deleted: true }, { status: 200 });
}
