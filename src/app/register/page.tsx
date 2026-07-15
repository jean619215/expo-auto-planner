"use client";

import Link from "next/link";
import { useState } from "react";
import { registerRequest } from "@/lib/auth-client";
import {
  isValidEmail,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/validation";
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

const REGISTER_SUCCESS_FALLBACK = "註冊成功，請至信箱點擊驗證連結完成驗證";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setErrorMsg("");
    setSuccessMsg("");

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
      const result = await registerRequest(email, password);
      if (result.ok) {
        setSuccessMsg(result.message ?? REGISTER_SUCCESS_FALLBACK);
        setPassword("");
      } else {
        setErrorMsg(result.error ?? "註冊失敗，請稍後再試");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm p-8">
        <CardHeader className="p-0">
          <CardTitle className="text-2xl font-semibold tracking-tight text-foreground">
            建立帳號
          </CardTitle>
          <CardDescription>
            註冊後需至信箱點擊驗證連結才能登入。
          </CardDescription>
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
              <span className="text-xs text-zinc-500">
                至少 {MIN_PASSWORD_LENGTH} 個字元
              </span>
            </div>

            {errorMsg && (
              <p role="alert" className="text-sm text-red-600">
                {errorMsg}
              </p>
            )}
            {successMsg && (
              <p role="status" className="text-sm text-green-600">
                {successMsg}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting ? "註冊中…" : "註冊"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-600">
            已有帳號？{" "}
            <Link href="/login" className="font-medium text-zinc-950 underline">
              前往登入
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
