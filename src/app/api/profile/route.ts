import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const PROFILE_COLUMNS = "id, nickname, role, created_at, updated_at";
const NICKNAME_MAX_LENGTH = 50;

const NOT_LOGGED_IN_ERROR = "請先登入";
const PROFILE_NOT_FOUND_ERROR = "找不到會員資料";
const SERVER_ERROR = "伺服器錯誤";
const INVALID_JSON_ERROR = "請求格式錯誤";
const ONLY_NICKNAME_ALLOWED_ERROR = "僅允許更新 nickname";
const INVALID_NICKNAME_ERROR = "nickname 須為字串且長度不可超過 50 字";

async function getAuthenticatedUser(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("GET /api/profile 查詢失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  if (data === null) {
    console.error("GET /api/profile 查無 profile row，user id:", user.id);
    return Response.json({ error: PROFILE_NOT_FOUND_ERROR }, { status: 404 });
  }

  return Response.json(data, { status: 200 });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();

  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: INVALID_JSON_ERROR }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: ONLY_NICKNAME_ALLOWED_ERROR }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "nickname") {
    return Response.json({ error: ONLY_NICKNAME_ALLOWED_ERROR }, { status: 400 });
  }

  const { nickname: rawNickname } = body as { nickname: unknown };

  if (
    (typeof rawNickname !== "string" && rawNickname !== null) ||
    (typeof rawNickname === "string" && [...rawNickname].length > NICKNAME_MAX_LENGTH)
  ) {
    return Response.json({ error: INVALID_NICKNAME_ERROR }, { status: 400 });
  }

  const nickname = rawNickname === "" ? null : rawNickname;

  const { data, error } = await supabase
    .from("profiles")
    .update({ nickname })
    .eq("id", user.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("PATCH /api/profile 更新失敗", error.code, error.message);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  if (data === null) {
    console.error("PATCH /api/profile 查無 profile row，user id:", user.id);
    return Response.json({ error: PROFILE_NOT_FOUND_ERROR }, { status: 404 });
  }

  return Response.json(data, { status: 200 });
}
