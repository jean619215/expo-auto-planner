import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

const VALID_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isValidOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (VALID_OTP_TYPES as string[]).includes(value);
}

const ERROR_MESSAGE = "驗證連結無效或已過期，請重新註冊或重寄驗證信";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!tokenHash || !isValidOtpType(type)) {
    return Response.json({ error: ERROR_MESSAGE }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return Response.json({ error: ERROR_MESSAGE }, { status: 400 });
  }

  // profile 已由 DB trigger (on_auth_user_created) 自動建立，本 route 不碰 profile。
  return Response.redirect(origin, 303);
}
