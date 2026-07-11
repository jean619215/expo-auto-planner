// Thin browser-side wrappers around our own /api/auth/* routes. The frontend
// never talks to the Supabase client directly (see AGENTS.md) — all auth flows
// go through these relative-path fetches. `credentials: "same-origin"` ensures
// the httpOnly session cookie is sent and any refreshed cookie is stored.

export type AuthResult = {
  ok: boolean;
  status: number;
  message?: string;
  error?: string;
};

const NETWORK_ERROR = "連線失敗，請稍後再試";

// 與 src/app/api/auth/login/route.ts 的 email_not_confirmed 分支固定字串一致，
// 供 login/page.tsx 判斷是否顯示「重新寄送驗證信」按鈕，而不必自行硬編字串。
export const EMAIL_NOT_CONFIRMED_ERROR = "請先至信箱完成驗證再登入";

async function postJson(
  path: string,
  body?: Record<string, unknown>
): Promise<AuthResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });

    let data: { message?: string; error?: string } = {};
    try {
      data = await res.json();
    } catch {
      // Non-JSON or empty body — leave data empty and rely on status.
    }

    return {
      ok: res.ok,
      status: res.status,
      message: data.message,
      error: data.error,
    };
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
}

export function registerRequest(
  email: string,
  password: string
): Promise<AuthResult> {
  return postJson("/api/auth/register", { email, password });
}

export function loginRequest(
  email: string,
  password: string
): Promise<AuthResult> {
  return postJson("/api/auth/login", { email, password });
}

export function logoutRequest(): Promise<AuthResult> {
  return postJson("/api/auth/logout");
}

export function resendVerificationRequest(email: string): Promise<AuthResult> {
  return postJson("/api/auth/resend", { email });
}
