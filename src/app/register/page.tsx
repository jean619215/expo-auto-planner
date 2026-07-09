"use client";

import Link from "next/link";
import { useState } from "react";
import { registerRequest } from "@/lib/auth-client";
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from "@/lib/validation";

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
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-black/8 bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          建立帳號
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          註冊後需至信箱點擊驗證連結才能登入。
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18"
            />
            <span className="text-xs text-zinc-500">
              至少 {MIN_PASSWORD_LENGTH} 個字元
            </span>
          </label>

          {errorMsg && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorMsg}
            </p>
          )}
          {successMsg && (
            <p role="status" className="text-sm text-green-600 dark:text-green-400">
              {successMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {submitting ? "註冊中…" : "註冊"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          已有帳號？{" "}
          <Link href="/login" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            前往登入
          </Link>
        </p>
      </div>
    </main>
  );
}
