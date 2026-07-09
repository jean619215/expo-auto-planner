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
