import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENERIC_RESEND_MESSAGE =
  "若該信箱已註冊且尚未驗證，驗證信已重新寄出";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("email" in body)) {
    return Response.json({ error: "缺少 email" }, { status: 400 });
  }

  const { email } = body as { email: unknown };

  if (typeof email !== "string" || !email) {
    return Response.json({ error: "缺少 email" }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return Response.json({ error: "email 格式錯誤" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: siteUrl
      ? { emailRedirectTo: `${siteUrl}/api/auth/confirm` }
      : undefined,
  });

  // 帳號枚舉防護：無論信箱是否存在、已驗證、或被 rate limit（含 429），對外一律
  // 回相同 status 200 + 相同的通用訊息，不透露該 email 的任何狀態。但 server 端
  // 仍記錄錯誤碼/訊息（絕不含 email），以免真實故障（如寄信服務異常）被靜默吞掉。
  if (error) {
    console.error(
      `[auth/resend] resend error: status=${error.status ?? "?"} code=${error.code ?? "?"} message=${error.message}`
    );
    return Response.json({ message: GENERIC_RESEND_MESSAGE }, { status: 200 });
  }

  // 帳號枚舉防護：成功與錯誤分支必須回相同 status code 與 body，
  // 否則客戶端可用 HTTP status 或訊息內容區分該 email 的註冊/驗證狀態。
  return Response.json({ message: GENERIC_RESEND_MESSAGE }, { status: 200 });
}
