import { createSupabaseServerClient } from "@/lib/supabase/server";

const GENERIC_LOGIN_ERROR = "帳號或密碼錯誤";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("email" in body) ||
    !("password" in body)
  ) {
    return Response.json({ error: "缺少 email 或 password" }, { status: 400 });
  }

  const { email, password } = body as { email: unknown; password: unknown };

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return Response.json({ error: "缺少 email 或 password" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return Response.json(
        { error: "請先至信箱完成驗證再登入" },
        { status: 403 }
      );
    }

    // 帳密錯誤或帳號不存在一律回相同的通用訊息，避免帳號枚舉。
    return Response.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  return Response.json(
    { message: "登入成功", userId: data.user?.id },
    { status: 200 }
  );
}
