import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

const GENERIC_REGISTER_MESSAGE =
  "註冊成功，請至信箱點擊驗證連結完成驗證";

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

  if (!EMAIL_REGEX.test(email)) {
    return Response.json({ error: "email 格式錯誤" }, { status: 400 });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `密碼長度至少需 ${MIN_PASSWORD_LENGTH} 個字元` },
      { status: 400 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: siteUrl
      ? { emailRedirectTo: `${siteUrl}/api/auth/confirm` }
      : undefined,
  });

  // 帳號枚舉防護：無論成功或 Supabase 回錯誤（如重複 email），對外一律回相同的通用訊息，
  // 不透露該 email 是否已註冊過。但 server 端仍記錄錯誤碼/訊息（不含 email/密碼等敏感資料），
  // 以免服務中斷或寄信 rate limit 等真實故障被靜默吞掉、無從排查。
  if (error) {
    console.error(
      `[auth/register] signUp error: status=${error.status ?? "?"} code=${error.code ?? "?"} message=${error.message}`
    );
    return Response.json({ message: GENERIC_REGISTER_MESSAGE }, { status: 200 });
  }

  // enable_confirmations = true，signUp 不會回傳 session；此 route 也不設任何 cookie。
  // 帳號枚舉防護：成功與錯誤（含重複 email）分支必須回相同 status code，
  // 否則客戶端可用 HTTP status 區分該 email 是否已註冊。兩者一律 200。
  return Response.json({ message: GENERIC_REGISTER_MESSAGE }, { status: 200 });
}
