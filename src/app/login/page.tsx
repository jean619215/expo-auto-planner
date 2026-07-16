"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  EMAIL_NOT_CONFIRMED_ERROR,
  loginRequest,
  resendVerificationRequest,
} from "@/lib/auth-client";
import {
  isValidEmail,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/validation";
import {
  RESEND_COOLDOWN_MS,
  clearCooldownEndsAt,
  readCooldownEndsAt,
  writeCooldownEndsAt,
} from "@/lib/resend-cooldown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

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
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm p-8">
        <CardHeader className="p-0">
          <CardTitle className="text-2xl font-black tracking-tight text-foreground">
            登入
          </CardTitle>
          <CardDescription>使用註冊時的 email 與密碼登入。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <form
            onSubmit={handleSubmit}
            className="mt-6 flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            {errorMsg && (
              <p role="alert" className="text-sm text-red-600">
                {errorMsg}
              </p>
            )}

            {showResend && (
              <div className="flex flex-col gap-2 rounded-lg border border-line bg-secondary p-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResendClick}
                  disabled={resendLoading || inCooldown}
                >
                  {resendLoading
                    ? "寄送中…"
                    : inCooldown
                      ? `重新寄送驗證信 (${remainingSeconds} 秒後可重試)`
                      : "重新寄送驗證信"}
                </Button>

                {resendMessage && (
                  <p className="text-sm text-zinc-700">{resendMessage}</p>
                )}

                {resendError && (
                  <p role="alert" className="text-sm text-amber-600">
                    {resendError}
                  </p>
                )}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting ? "登入中…" : "登入"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-600">
            還沒有帳號？{" "}
            <Link
              href="/register"
              className="font-medium text-zinc-950 underline"
            >
              前往註冊
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
