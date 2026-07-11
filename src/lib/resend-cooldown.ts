// 重寄驗證信的 60 秒冷卻計時器,以純函式包裝 localStorage 讀寫。
// 只存一個「全域」(不分 email) 的冷卻到期時間戳 (數字),不存 email/token 等任何
// 可識別使用者的資訊 —— 對齊 AGENTS.md 防枚舉與最小化持久化資料的安全規則。
// 所有函式皆 try/catch 包裹,localStorage 不可用時 (無痕模式限制等) 靜默降級,
// 絕不 throw,呼叫端可安全地把倒數狀態退回 in-memory only。

export const RESEND_COOLDOWN_STORAGE_KEY = "auth:resend_cooldown_ends_at";
export const RESEND_COOLDOWN_MS = 60_000;

export function readCooldownEndsAt(): number | null {
  try {
    const raw = window.localStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeCooldownEndsAt(endsAt: number): void {
  try {
    window.localStorage.setItem(RESEND_COOLDOWN_STORAGE_KEY, String(endsAt));
  } catch {
    // localStorage 不可用 —— 靜默降級,冷卻僅在本頁面內以 state 生效。
  }
}

export function clearCooldownEndsAt(): void {
  try {
    window.localStorage.removeItem(RESEND_COOLDOWN_STORAGE_KEY);
  } catch {
    // 同上,忽略即可。
  }
}
