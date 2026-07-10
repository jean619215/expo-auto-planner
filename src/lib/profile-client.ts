// Thin browser-side wrapper around our own /api/profile route. The frontend
// never talks to the Supabase client directly (see AGENTS.md) — this uses a
// relative-path fetch with `credentials: "same-origin"` so the httpOnly
// session cookie is sent automatically.

export type Profile = {
  id: string;
  nickname: string | null;
  role: string;
  created_at: string;
  updated_at: string;
};

export type ProfileResult = {
  ok: boolean;
  status: number;
  profile?: Profile;
  error?: string;
};

const NETWORK_ERROR = "連線失敗，請稍後再試";

async function toResult(res: Response): Promise<ProfileResult> {
  let data: Partial<Profile> & { error?: string } = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON or empty body — leave data empty and rely on status.
  }

  return {
    ok: res.ok,
    status: res.status,
    profile: res.ok ? (data as Profile) : undefined,
    error: data.error,
  };
}

export async function getProfileRequest(): Promise<ProfileResult> {
  try {
    const res = await fetch("/api/profile", { credentials: "same-origin" });
    return await toResult(res);
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
}

export async function updateNicknameRequest(
  nickname: string | null
): Promise<ProfileResult> {
  try {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname }),
      credentials: "same-origin",
    });
    return await toResult(res);
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
}
