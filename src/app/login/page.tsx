"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EMAIL_NOT_CONFIRMED_ERROR, loginRequest, resendVerificationRequest } from "@/lib/auth-client";
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from "@/lib/validation";
import {
  RESEND_COOLDOWN_MS,
  clearCooldownEndsAt,
  readCooldownEndsAt,
  writeCooldownEndsAt,
} from "@/lib/resend-cooldown";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showResend, setShowResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendError, setResendError] = useState("");
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // 掛載時（僅 client 端）讀取 localStorage 中尚未到期的冷卻時間戳，恢復倒數。
  // setState 包在 queueMicrotask 中延後執行，避免 react-hooks/set-state-in-effect
  // 對「effect body 內直接同步呼叫 setState」的告警（與 profile/page.tsx 既有的
  // 「setState 包在非同步 callback 內」慣例一致）。
  useEffect(() => {
    queueMicrotask(() => {
      const storedEndsAt = readCooldownEndsAt();
      if (storedEndsAt && storedEndsAt > Date.now()) {
        setCooldownEndsAt(storedEndsAt);
        setShowResend(true);
      } else if (storedEndsAt) {
        clearCooldownEndsAt();
      }
    });
  }, []);

  // 倒數計時：以目前時間對照到期時間戳重新計算剩餘秒數，避免背景分頁節流造成漂移。
  useEffect(() => {
    if (!cooldownEndsAt) {
      queueMicrotask(() => setNow(null));
      return;
    }
    queueMicrotask(() => setNow(Date.now()));
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [cooldownEndsAt]);

  // 倒數歸零時自動恢復 idle 並清除 localStorage。
  useEffect(() => {
    if (cooldownEndsAt && now !== null && now >= cooldownEndsAt) {
      queueMicrotask(() => {
        setCooldownEndsAt(null);
        clearCooldownEndsAt();
      });
    }
  }, [now, cooldownEndsAt]);

  const remainingSeconds =
    cooldownEndsAt && now !== null
      ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
      : 0;
  const inCooldown = remainingSeconds > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setErrorMsg("");

    if (!isValidEmail(email)) {
      setErrorMsg("請輸入有效的 email 格式");
      return;
    }
    if (!isValidPassword(password)) {
      setErrorMsg(`密碼長度至少需 ${MIN_PASSWORD_LENGTH} 個字元`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await loginRequest(email, password);
      if (result.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setErrorMsg(result.error ?? "登入失敗，請稍後再試");
      setShowResend(result.error === EMAIL_NOT_CONFIRMED_ERROR);
      setResendMessage("");
      setResendError("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendClick() {
    if (resendLoading || inCooldown) return;
    setResendLoading(true);
    setResendError("");
    setResendMessage("");
    try {
      const result = await resendVerificationRequest(email);
      if (result.ok) {
        setResendMessage(result.message ?? "");
        const endsAt = Date.now() + RESEND_COOLDOWN_MS;
        setCooldownEndsAt(endsAt);
        writeCooldownEndsAt(endsAt);
      } else {
        setResendError(result.error ?? "連線失敗，請稍後再試");
      }
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-black/8 bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          登入
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          使用註冊時的 email 與密碼登入。
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">密碼</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18"
            />
          </label>

          {errorMsg && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorMsg}
            </p>
          )}

          {showResend && (
            <div className="flex flex-col gap-2 rounded-lg border border-black/8 bg-zinc-50 p-3 dark:border-white/[.145] dark:bg-zinc-900">
              <button
                type="button"
                onClick={handleResendClick}
                disabled={resendLoading || inCooldown}
                className="h-10 rounded-full border border-black/12 px-4 text-sm font-medium transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/18 dark:hover:bg-white/5"
              >
                {resendLoading
                  ? "寄送中…"
                  : inCooldown
                    ? `重新寄送驗證信 (${remainingSeconds} 秒後可重試)`
                    : "重新寄送驗證信"}
              </button>

              {resendMessage && (
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{resendMessage}</p>
              )}

              {resendError && (
                <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
                  {resendError}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {submitting ? "登入中…" : "登入"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          還沒有帳號？{" "}
          <Link href="/register" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            前往註冊
          </Link>
        </p>
      </div>
    </main>
  );
}
